-- Iminationz POS — Backdated Bill migration
-- Adds an optional p_bill_date parameter to create_bill() so a bill can be
-- recorded against a past date (e.g. entering yesterday's paper-ledger sale).
-- Run this in Supabase SQL Editor once. Idempotent (CREATE OR REPLACE).
-- After running, if the app still errors with "function not found",
-- run: NOTIFY pgrst, 'reload schema';  on its own.
--
-- Behavior:
--   - p_bill_date = NULL (or omitted)  -> today, exactly as before.
--   - p_bill_date = a past date        -> the bill's date/day/bill_number
--     use that date; iso (used for exact ordering/sorting) is set to noon
--     on that date so the bill sorts correctly among same-day bills without
--     claiming a fake time-of-day.
--   - Future dates are rejected — this is for recording past sales, not
--     scheduling ahead.
-- Stock deduction, discount rule, and payment validation are unchanged.

BEGIN;

-- CREATE OR REPLACE does not remove an old signature when the parameter
-- list changes — it adds a new overload alongside it, which makes
-- PostgREST/Postgres unable to pick a candidate when a caller doesn't name
-- every argument ("Could not choose the best candidate function..."). Drop
-- the old 5-param signature explicitly before creating the 6-param one.
DROP FUNCTION IF EXISTS public.create_bill(text, text, jsonb, numeric, numeric);

CREATE OR REPLACE FUNCTION public.create_bill(
  p_customer_mobile text,
  p_customer_name   text,
  p_items           jsonb,
  p_cash_amount     numeric,
  p_upi_amount      numeric,
  p_bill_date       date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_now         timestamptz := now() at time zone 'Asia/Kolkata';
  v_today       date := v_now::date;
  v_date        date := coalesce(p_bill_date, v_today);
  v_day         text;
  v_time        text := to_char(v_now, 'HH24:MI:SS');
  v_iso         timestamptz;
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

  IF v_date > v_today THEN
    RAISE EXCEPTION 'Bill date cannot be in the future';
  END IF;

  -- Backdated bills keep the current time-of-day if entered same-day, but
  -- for a genuinely past date we pin the stored timestamp to noon on that
  -- date so ordering among that day's bills is stable and doesn't imply a
  -- time that never happened.
  IF v_date = v_today THEN
    v_iso := now();
  ELSE
    v_iso := (v_date::timestamp + interval '12 hours') at time zone 'Asia/Kolkata';
  END IF;
  v_day := to_char(v_date, 'FMDay');

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

  v_paid := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 0);
  IF v_paid <> v_final THEN
    RAISE EXCEPTION 'Cash + UPI (%) must equal Final Amount (%)', v_paid, v_final;
  END IF;

  -- Deduct inventory (stock is deducted now regardless of the bill's
  -- recorded date — there is no "historical stock level" to roll back to).
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

GRANT EXECUTE ON FUNCTION public.create_bill(text, text, jsonb, numeric, numeric, date) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
