-- Iminationz POS — Edit Bill migration
-- Run this in Supabase SQL Editor once. Idempotent (CREATE OR REPLACE).
-- After running, if the app still errors with "function not found",
-- run: NOTIFY pgrst, 'reload schema';  on its own.
--
-- edit_bill() replaces a bill's line items, customer info, and payment
-- split all at once, atomically:
--   1. Restores stock for every existing line item on the bill.
--   2. Deletes the old line items.
--   3. Validates + deducts stock for the new item list.
--   4. Recomputes gross/discount/final using the same discount rule
--      create_bill() uses.
--   5. Updates the bills row and inserts the new bill_items rows.
-- If anything fails partway (insufficient stock, bad payment split),
-- the whole thing rolls back — stock is never left half-adjusted.
--
-- Owner-only enforcement lives in the app (Owner role check before
-- showing the Edit Bill screen), not in this function — RLS on these
-- tables already requires an authenticated session.

BEGIN;

CREATE OR REPLACE FUNCTION public.edit_bill(
  p_bill_id         uuid,
  p_customer_mobile text,
  p_customer_name   text,
  p_items           jsonb,  -- [{inv_id, qty, custom_price?}]
  p_cash_amount     numeric,
  p_upi_amount      numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_gross       numeric(12,0) := 0;
  v_discount    numeric(12,0) := 0;
  v_final       numeric(12,0);
  v_paid        numeric(12,0);
  v_item        jsonb;
  v_old_item    record;
  v_inv         public.inventory%rowtype;
  v_qty         integer;
  v_price       numeric;
  v_line_total  numeric(12,0);
  v_normalized  jsonb := '[]'::jsonb;
  v_disc_type   text := 'percent';
  v_disc_value  numeric := 10;
  v_disc_min    numeric := 699;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bills WHERE id = p_bill_id) THEN
    RAISE EXCEPTION 'Bill not found';
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

  -- Step 1: restore stock for every existing line item on this bill.
  FOR v_old_item IN SELECT * FROM public.bill_items WHERE bill_id = p_bill_id
  LOOP
    IF v_old_item.inv_id IS NOT NULL THEN
      UPDATE public.inventory
         SET current_qty = current_qty + v_old_item.qty,
             sold_qty     = GREATEST(sold_qty - v_old_item.qty, 0),
             last_updated = now()
       WHERE id = v_old_item.inv_id;
    END IF;
  END LOOP;

  -- Step 2: remove old line items (stock already restored above).
  DELETE FROM public.bill_items WHERE bill_id = p_bill_id;

  -- Step 3: validate stock & compute totals for the new item list.
  -- custom_price (if provided) overrides the inventory price for that line,
  -- same convention create_bill()/exchange_bill_item() use elsewhere.
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
    v_price := COALESCE((v_item->>'custom_price')::numeric, v_inv.price);
    v_line_total := round(v_price * v_qty, 0);
    v_gross := v_gross + v_line_total;
    v_normalized := v_normalized || jsonb_build_object(
      'inv_id', v_inv.id,
      'item_id', v_inv.item_id,
      'item_name', v_inv.item_name,
      'price', round(v_price, 0),
      'qty', v_qty,
      'line_total', v_line_total
    );
  END LOOP;

  -- Discount rule: percent or flat, only when gross > min order — same as create_bill().
  IF v_gross > v_disc_min THEN
    IF lower(coalesce(v_disc_type,'percent')) = 'flat' THEN
      v_discount := round(v_disc_value, 0);
    ELSE
      v_discount := round(v_gross * (v_disc_value / 100.0), 0);
    END IF;
    IF v_discount > v_gross THEN v_discount := v_gross; END IF;
  END IF;
  v_final := v_gross - v_discount;

  v_paid := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 0);
  IF v_paid <> v_final THEN
    RAISE EXCEPTION 'Cash + UPI (%) must equal Final Amount (%)', v_paid, v_final;
  END IF;

  -- Step 4: deduct stock for the new item list.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    v_qty := (v_item->>'qty')::int;
    UPDATE public.inventory
       SET current_qty = current_qty - v_qty,
           sold_qty     = sold_qty + v_qty,
           last_updated = now()
     WHERE id = (v_item->>'inv_id')::uuid
       AND current_qty >= v_qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Stock changed for %, please retry', v_item->>'item_name';
    END IF;
  END LOOP;

  -- Step 5: update the bill row and insert new line items.
  UPDATE public.bills SET
    customer_mobile = nullif(trim(coalesce(p_customer_mobile,'')),''),
    customer_name   = nullif(trim(coalesce(p_customer_name,'')),''),
    gross_amount    = v_gross,
    discount        = v_discount,
    final_amount    = v_final,
    cash_amount     = coalesce(round(p_cash_amount,0),0),
    upi_amount      = coalesce(round(p_upi_amount,0),0)
  WHERE id = p_bill_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_normalized)
  LOOP
    INSERT INTO public.bill_items(bill_id, inv_id, item_id, item_name, price, qty, line_total)
    VALUES (
      p_bill_id,
      (v_item->>'inv_id')::uuid,
      v_item->>'item_id',
      v_item->>'item_name',
      (v_item->>'price')::numeric,
      (v_item->>'qty')::int,
      (v_item->>'line_total')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', p_bill_id,
    'gross_amount', v_gross,
    'discount', v_discount,
    'final_amount', v_final
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_bill(uuid, text, text, jsonb, numeric, numeric) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
