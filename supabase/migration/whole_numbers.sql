-- =====================================================================
-- Iminationz POS — Whole-Number Amounts Migration
-- ---------------------------------------------------------------------
-- Fixes: "Cash + UPI (877.00) must equal Final Amount (876.80)"
--
-- Root cause: create_bill() / exchange_bill_item() recompute totals
-- from the raw `inventory.price` column and round to 2 decimal places.
-- The app's UI already shows whole rupees, so a bill whose UI total is
-- ₹877 could still be recalculated server-side as ₹876.80 whenever any
-- item price had a fractional value — causing the payment-mismatch
-- error even though the app never let the user type decimals.
--
-- This migration:
--   1. Rounds every existing decimal amount in the database to the
--      nearest whole rupee (prices, bill totals, expenses, damaged
--      item prices, exchange history) — permanent, one-time cleanup.
--   2. Rewrites create_bill(), exchange_bill_item() and sell_damaged()
--      to round every computed amount to 0 decimals (instead of 2), so
--      new bills/exchanges can never mismatch against the whole-number
--      totals the app already shows.
--
-- Safe to re-run. Guards every optional table (damaged_items, expenses,
-- exchange_history) with to_regclass() so this works whether or not
-- you've run those feature migrations yet.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Round existing decimal data to whole numbers
-- ---------------------------------------------------------------------

UPDATE public.inventory
   SET price      = round(price, 0),
       cost_price = round(cost_price, 0);

UPDATE public.bills
   SET gross_amount = round(gross_amount, 0),
       discount     = round(discount, 0),
       final_amount = round(final_amount, 0),
       cash_amount  = round(cash_amount, 0),
       upi_amount   = round(upi_amount, 0);

UPDATE public.bill_items
   SET price      = round(price, 0),
       line_total = round(line_total, 0);

DO $$
BEGIN
  IF to_regclass('public.damaged_items') IS NOT NULL THEN
    UPDATE public.damaged_items
       SET unit_price = round(unit_price, 0),
           sold_price  = CASE WHEN sold_price IS NULL THEN NULL ELSE round(sold_price, 0) END;
  END IF;

  IF to_regclass('public.expenses') IS NOT NULL THEN
    UPDATE public.expenses
       SET amount          = round(amount, 0),
           personal_amount = round(personal_amount, 0),
           business_amount = round(business_amount, 0);
  END IF;

  IF to_regclass('public.expense_items') IS NOT NULL THEN
    UPDATE public.expense_items
       SET amount          = round(amount, 0),
           personal_amount = round(personal_amount, 0),
           business_amount = round(business_amount, 0);
  END IF;

  IF to_regclass('public.exchange_history') IS NOT NULL THEN
    UPDATE public.exchange_history
       SET old_price      = round(old_price, 0),
           old_line_total = round(old_line_total, 0),
           new_price      = round(new_price, 0),
           new_line_total = round(new_line_total, 0),
           price_diff     = round(price_diff, 0),
           cash_settled   = round(cash_settled, 0),
           upi_settled    = round(upi_settled, 0);
  END IF;

  IF to_regclass('public.app_settings') IS NOT NULL THEN
    UPDATE public.app_settings
       SET value_num = round(value_num, 0)
     WHERE value_num IS NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Rewrite create_bill() — round everything to 0 decimals
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_bill(
  p_customer_mobile text,
  p_customer_name   text,
  p_items           jsonb,
  p_cash_amount     numeric,
  p_upi_amount      numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_now         timestamptz := now() at time zone 'Asia/Kolkata';
  v_date        date := v_now::date;
  v_day         text := to_char(v_now, 'FMDay');
  v_time        text := to_char(v_now, 'HH24:MI:SS');
  v_iso         timestamptz := now();
  v_gross       numeric(12,0) := 0;
  v_discount    numeric(12,0) := 0;
  v_final       numeric(12,0);
  v_paid        numeric(12,0);
  v_bill_id     uuid := gen_random_uuid();
  v_bill_number text;
  v_item        jsonb;
  v_inv         public.inventory%rowtype;
  v_qty         integer;
  v_line_total  numeric(12,0);
  v_normalized  jsonb := '[]'::jsonb;
  v_disc_type   text := 'percent';
  v_disc_value  numeric := 10;
  v_disc_min    numeric := 699;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;

  -- Load current discount configuration from app_settings (defaults if missing).
  IF to_regclass('public.app_settings') IS NOT NULL THEN
    SELECT COALESCE(value_text,'percent') INTO v_disc_type
      FROM public.app_settings WHERE key = 'discount_type';
    SELECT COALESCE(value_num, 10) INTO v_disc_value
      FROM public.app_settings WHERE key = 'discount_value';
    SELECT COALESCE(value_num, 699) INTO v_disc_min
      FROM public.app_settings WHERE key = 'discount_min_order';
  END IF;

  -- Validate stock & compute gross (whole rupees at every step)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::int;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty %', v_qty;
    END IF;
    SELECT * INTO v_inv FROM public.inventory WHERE id = (v_item->>'inv_id')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % not found', v_item->>'inv_id';
    END IF;
    IF v_inv.current_qty < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for % (available %)', v_inv.item_name, v_inv.current_qty;
    END IF;
    v_line_total := round(v_inv.price * v_qty, 0);
    v_gross := v_gross + v_line_total;
    v_normalized := v_normalized || jsonb_build_object(
      'inv_id', v_inv.id,
      'item_id', v_inv.item_id,
      'item_name', v_inv.item_name,
      'price', round(v_inv.price, 0),
      'qty', v_qty,
      'line_total', v_line_total
    );
  END LOOP;

  -- Discount rule: percent or flat, only when gross > min order
  IF v_gross > v_disc_min THEN
    IF lower(coalesce(v_disc_type,'percent')) = 'flat' THEN
      v_discount := round(v_disc_value, 0);
    ELSE
      v_discount := round(v_gross * (v_disc_value / 100.0), 0);
    END IF;
    IF v_discount > v_gross THEN v_discount := v_gross; END IF;
  END IF;
  v_final := v_gross - v_discount;

  -- Payment validation — both sides are now whole rupees, so this is
  -- an exact match (no more 877.00 vs 876.80 style rounding mismatch).
  v_paid := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 0);
  IF v_paid <> v_final THEN
    RAISE EXCEPTION 'Cash + UPI (%) must equal Final Amount (%)', v_paid, v_final;
  END IF;

  -- Deduct inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    v_qty := (v_item->>'qty')::int;
    UPDATE public.inventory
       SET current_qty = current_qty - v_qty,
           sold_qty    = sold_qty + v_qty,
           last_updated = now()
     WHERE id = (v_item->>'inv_id')::uuid
       AND current_qty >= v_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock changed for %, please retry', v_item->>'item_name';
    END IF;
  END LOOP;

  v_bill_number := public.next_bill_number(v_date);

  INSERT INTO public.bills(
    id, bill_number, customer_mobile, customer_name, date, day, time, iso,
    gross_amount, discount, final_amount, cash_amount, upi_amount, payment_status
  ) VALUES (
    v_bill_id, v_bill_number,
    nullif(trim(coalesce(p_customer_mobile,'')),''),
    nullif(trim(coalesce(p_customer_name,'')),''),
    v_date, v_day, v_time, v_iso,
    v_gross, v_discount, v_final,
    coalesce(round(p_cash_amount,0),0), coalesce(round(p_upi_amount,0),0),
    'PAID'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    INSERT INTO public.bill_items(bill_id, inv_id, item_id, item_name, price, qty, line_total)
    VALUES (
      v_bill_id,
      (v_item->>'inv_id')::uuid,
      v_item->>'item_id',
      v_item->>'item_name',
      (v_item->>'price')::numeric,
      (v_item->>'qty')::int,
      (v_item->>'line_total')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_bill_id,
    'bill_number', v_bill_number,
    'gross_amount', v_gross,
    'discount', v_discount,
    'final_amount', v_final
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bill(text, text, jsonb, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Rewrite exchange_bill_item() — round everything to 0 decimals
--    (only if the exchange feature has been installed)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.exchange_history') IS NULL THEN
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

    IF v_old_inv.id IS NOT NULL THEN
      UPDATE public.inventory
         SET current_qty  = current_qty + v_old_line.qty,
             sold_qty     = greatest(sold_qty - v_old_line.qty, 0),
             last_updated = v_now
       WHERE id = v_old_inv.id;
    END IF;

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

    UPDATE public.bill_items
       SET inv_id     = v_new_inv.id,
           item_id    = v_new_inv.item_id,
           item_name  = v_new_inv.item_name,
           price      = round(v_new_inv.price, 0),
           qty        = p_new_qty,
           line_total = v_new_line_total
     WHERE id = p_old_bill_item_id;

    SELECT coalesce(sum(round(line_total, 0)), 0) INTO v_new_gross
      FROM public.bill_items WHERE bill_id = p_bill_id;

    IF v_new_gross > 699 THEN
      v_new_discount := round(v_new_gross * 0.10, 0);
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
      SELECT role INTO v_role FROM public.user_roles WHERE email = v_email;
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

    INSERT INTO public.exchange_history(
      bill_id, bill_number,
      old_bill_item_id, old_inv_id,
      old_item_id, old_item_name, old_qty, old_price, old_line_total,
      new_inv_id, new_item_id, new_item_name, new_qty, new_price, new_line_total,
      price_diff, cash_settled, upi_settled,
      exchanged_at, exchanged_by_email, exchanged_by_role
    ) VALUES (
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

-- ---------------------------------------------------------------------
-- 4. Rewrite sell_damaged() — round sold price to 0 decimals
--    (only if the damaged-items feature has been installed)
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.damaged_items') IS NULL THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.sell_damaged(
    p_damaged_id  uuid,
    p_sold_price  numeric,
    p_note        text
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  AS $fn$
  DECLARE
    v_row public.damaged_items%rowtype;
    v_price numeric(12,0);
  BEGIN
    SELECT * INTO v_row FROM public.damaged_items WHERE id = p_damaged_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Damaged entry not found';
    END IF;
    IF v_row.status <> 'in_stock' THEN
      RAISE EXCEPTION 'Damaged entry already % ', v_row.status;
    END IF;
    IF p_sold_price IS NULL OR p_sold_price < 0 THEN
      RAISE EXCEPTION 'Sold price must be >= 0';
    END IF;
    v_price := round(p_sold_price, 0);

    UPDATE public.damaged_items
       SET status     = 'sold',
           sold_price = v_price,
           sold_at    = now(),
           sold_note  = nullif(btrim(coalesce(p_note,'')),'')
     WHERE id = p_damaged_id;

    RETURN jsonb_build_object('id', p_damaged_id, 'status', 'sold');
  END;
  $fn$;

  GRANT EXECUTE ON FUNCTION public.sell_damaged(uuid, numeric, text) TO authenticated;
END $$;

COMMIT;

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- DONE. Paste this whole file into Supabase → SQL Editor → Run.
-- After this, every new bill, exchange, damaged-item sale, expense and
-- inventory price will always be a whole rupee — no more decimal
-- mismatches on Cash + UPI validation.
-- =====================================================================
