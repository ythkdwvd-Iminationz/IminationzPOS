-- Iminationz POS — Exchange custom-price flag fix
--
-- exchange_bill_item() always swaps to the catalog price (exchange has
-- never supported setting a custom price), but it never cleared
-- bill_items.is_custom_price on the line it updates. So a line that was
-- originally custom-priced kept a stale is_custom_price = true after being
-- exchanged, even though its price is now the plain catalog price — which
-- would incorrectly exclude that line from discount calculations anywhere
-- that flag is read (e.g. Edit Bill).
--
-- This is the exact same function body as whole_numbers.sql's
-- exchange_bill_item() (10% flat discount over ₹699, exchange_history
-- logging, exchanged_at/exchange_count/last_exchanged_by_* tracking — all
-- unchanged) with exactly one addition: is_custom_price = false on the
-- UPDATE public.bill_items statement.
--
-- Run this in Supabase SQL Editor once. Idempotent (CREATE OR REPLACE).
-- Safe to run even though exchange_bill_item's signature is unchanged —
-- no overload risk like the create_bill() incident.

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
           line_total = v_new_line_total,
           is_custom_price = false
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


NOTIFY pgrst, 'reload schema';
