-- =====================================================================
-- Iminationz POS — Fix "duplicate key value violates unique constraint"
--                   when doing an Exchange
-- ---------------------------------------------------------------------
-- Reported by user: Exchange flow throwing a duplicate-key error.
--
-- The current exchange_bill_item() RPC has no defensive handling for
-- unique_violation. This migration:
--
--   1. Rewrites exchange_bill_item() to wrap the exchange_history INSERT
--      in a retry loop that catches unique_violation and re-generates a
--      fresh UUID. Handles the (astronomical but not impossible) case
--      of a uuid_generate_v4() collision or a legacy row using the
--      same PK.
--
--   2. Re-raises any other unique_violation with the specific
--      constraint name included in the message, so if a different
--      constraint is being hit we can see it in the app's error toast
--      instead of the raw Postgres text.
--
--   3. Ensures uuid_generate_v4() exists (uuid-ossp extension) — the
--      exchange_history table's default depends on it.
--
-- Depends on: schema.sql, exchange.sql, whole_numbers.sql. Safe to rerun.
-- =====================================================================

BEGIN;

-- Make absolutely sure uuid_generate_v4() exists — bill/exchange_history
-- default columns need it.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF to_regclass('public.exchange_history') IS NULL THEN
    RAISE NOTICE 'exchange_history table missing — run exchange.sql first';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.exchange_bill_item(
    p_bill_id           uuid,
    p_old_bill_item_id  uuid,
    p_new_inv_id        uuid,
    p_new_qty           integer,
    p_cash_amount       numeric,
    p_upi_amount        numeric
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  AS $fn$
  DECLARE
    v_bill              public.bills%rowtype;
    v_old_line          public.bill_items%rowtype;
    v_old_inv           public.inventory%rowtype;
    v_new_inv           public.inventory%rowtype;
    v_new_line_total    numeric(12,0);
    v_price_diff        numeric(12,0);
    v_settlement        numeric(12,0);
    v_new_gross         numeric(12,0) := 0;
    v_new_discount      numeric(12,0) := 0;
    v_new_final         numeric(12,0);
    v_now               timestamptz := now();
    v_email             text;
    v_role              text;
    v_history_id        uuid;
    v_retries           integer := 0;
    v_constraint        text;
    v_disc_type         text := 'percent';
    v_disc_value        numeric := 10;
    v_disc_min          numeric := 699;
  BEGIN
    IF p_new_qty IS NULL OR p_new_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid new quantity %', p_new_qty;
    END IF;

    SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill % not found', p_bill_id;
    END IF;

    SELECT * INTO v_old_line
      FROM public.bill_items
     WHERE id = p_old_bill_item_id AND bill_id = p_bill_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bill item % not found on bill %', p_old_bill_item_id, p_bill_id;
    END IF;

    IF v_old_line.inv_id IS NOT NULL THEN
      SELECT * INTO v_old_inv FROM public.inventory WHERE id = v_old_line.inv_id;
    END IF;

    SELECT * INTO v_new_inv FROM public.inventory WHERE id = p_new_inv_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New inventory item % not found', p_new_inv_id;
    END IF;
    IF v_new_inv.current_qty < p_new_qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (available %)',
        v_new_inv.item_name, v_new_inv.current_qty;
    END IF;

    v_new_line_total := round(v_new_inv.price * p_new_qty, 0);
    v_price_diff     := v_new_line_total - round(v_old_line.line_total, 0);
    v_settlement     := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 0);

    IF v_settlement <> v_price_diff THEN
      RAISE EXCEPTION
        'Settlement (cash % + upi % = %) must equal price difference %',
        coalesce(round(p_cash_amount,0),0), coalesce(round(p_upi_amount,0),0),
        v_settlement, v_price_diff;
    END IF;

    -- Return the old qty back to the old inventory row (if still exists).
    IF v_old_inv.id IS NOT NULL THEN
      UPDATE public.inventory
         SET current_qty  = current_qty + v_old_line.qty,
             sold_qty     = greatest(sold_qty - v_old_line.qty, 0),
             last_updated = v_now
       WHERE id = v_old_inv.id;
    END IF;

    -- Deduct new qty from new inventory + bump exchange_count.
    UPDATE public.inventory
       SET current_qty    = current_qty - p_new_qty,
           sold_qty       = sold_qty + p_new_qty,
           exchange_count = exchange_count + 1,
           last_updated   = v_now
     WHERE id = v_new_inv.id
       AND current_qty >= p_new_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock changed for %, please retry', v_new_inv.item_name;
    END IF;

    -- Replace the bill_item line in place (no PK/unique conflicts possible).
    UPDATE public.bill_items
       SET inv_id     = v_new_inv.id,
           item_id    = v_new_inv.item_id,
           item_name  = v_new_inv.item_name,
           price      = round(v_new_inv.price, 0),
           qty        = p_new_qty,
           line_total = v_new_line_total
     WHERE id = p_old_bill_item_id;

    -- Recompute bill gross from remaining line items.
    SELECT coalesce(sum(round(line_total, 0)), 0) INTO v_new_gross
      FROM public.bill_items WHERE bill_id = p_bill_id;

    -- Read configurable discount if the table exists (respects owner's
    -- settings from custom_pricing.sql / billing_config_damaged.sql).
    IF to_regclass('public.app_settings') IS NOT NULL THEN
      SELECT COALESCE(value_text,'percent') INTO v_disc_type
        FROM public.app_settings WHERE key = 'discount_type';
      SELECT COALESCE(value_num, 10) INTO v_disc_value
        FROM public.app_settings WHERE key = 'discount_value';
      SELECT COALESCE(value_num, 699) INTO v_disc_min
        FROM public.app_settings WHERE key = 'discount_min_order';
    END IF;

    IF v_new_gross > v_disc_min THEN
      IF lower(coalesce(v_disc_type,'percent')) = 'flat' THEN
        v_new_discount := round(v_disc_value, 0);
      ELSE
        v_new_discount := round(v_new_gross * (v_disc_value / 100.0), 0);
      END IF;
      IF v_new_discount > v_new_gross THEN v_new_discount := v_new_gross; END IF;
    ELSE
      v_new_discount := 0;
    END IF;
    v_new_final := v_new_gross - v_new_discount;

    BEGIN
      v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
    EXCEPTION WHEN OTHERS THEN
      v_email := NULL;
    END;
    IF v_email IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL THEN
      SELECT role INTO v_role FROM public.user_roles
       WHERE lower(trim(email)) = lower(trim(v_email));
    END IF;

    UPDATE public.bills
       SET gross_amount            = v_new_gross,
           discount                = v_new_discount,
           final_amount            = v_new_final,
           cash_amount             = round(cash_amount + coalesce(p_cash_amount,0), 0),
           upi_amount              = round(upi_amount  + coalesce(p_upi_amount,0),  0),
           exchanged_at            = v_now,
           exchange_count          = coalesce(exchange_count,0) + 1,
           last_exchanged_by_email = v_email,
           last_exchanged_by_role  = v_role
     WHERE id = p_bill_id;

    -- Insert the exchange_history audit row with a retry loop that
    -- catches unique_violation. In the astronomical case of a
    -- uuid_generate_v4() collision (or a legacy row using the same PK)
    -- this generates a fresh UUID and retries. If any OTHER unique
    -- constraint is being hit, we re-raise a friendlier error naming
    -- the actual constraint so the source of the bug is obvious in
    -- the app's error toast (instead of the raw Postgres text).
    LOOP
      v_history_id := uuid_generate_v4();
      BEGIN
        INSERT INTO public.exchange_history(
          id,
          bill_id, bill_number,
          old_bill_item_id, old_inv_id,
          old_item_id, old_item_name, old_qty, old_price, old_line_total,
          new_inv_id, new_item_id, new_item_name, new_qty, new_price, new_line_total,
          price_diff, cash_settled, upi_settled,
          exchanged_at, exchanged_by_email, exchanged_by_role
        ) VALUES (
          v_history_id,
          p_bill_id, v_bill.bill_number,
          p_old_bill_item_id, v_old_line.inv_id,
          v_old_line.item_id, v_old_line.item_name, v_old_line.qty,
          round(v_old_line.price, 0), round(v_old_line.line_total, 0),
          v_new_inv.id, v_new_inv.item_id, v_new_inv.item_name, p_new_qty,
          round(v_new_inv.price, 0), v_new_line_total,
          v_price_diff,
          coalesce(round(p_cash_amount,0),0), coalesce(round(p_upi_amount,0),0),
          v_now, v_email, v_role
        );
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        -- If it's the PK, retry with a fresh UUID. If it's any other
        -- unique constraint, that's a real data issue we should surface.
        IF v_constraint = 'exchange_history_pkey' THEN
          v_retries := v_retries + 1;
          IF v_retries > 5 THEN
            RAISE EXCEPTION
              'Could not allocate a unique exchange_history id after % retries', v_retries;
          END IF;
          CONTINUE;
        ELSE
          RAISE EXCEPTION
            'Exchange blocked by unique constraint "%": please share this text with support',
            v_constraint;
        END IF;
      END;
    END LOOP;

    RETURN jsonb_build_object(
      'bill_id',              p_bill_id,
      'old_item_name',        v_old_line.item_name,
      'new_item_name',        v_new_inv.item_name,
      'price_diff',           v_price_diff,
      'settlement_collected', v_settlement,
      'new_gross_amount',     v_new_gross,
      'new_discount',         v_new_discount,
      'new_final_amount',     v_new_final,
      'exchanged_at',         v_now
    );
  END;
  $fn$;

  GRANT EXECUTE ON FUNCTION public.exchange_bill_item(uuid, uuid, uuid, integer, numeric, numeric)
    TO authenticated;
END $$;

COMMIT;
