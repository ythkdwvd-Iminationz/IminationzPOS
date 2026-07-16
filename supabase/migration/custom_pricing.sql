-- =====================================================================
-- Iminationz POS — Owner Custom Pricing Migration
-- ---------------------------------------------------------------------
-- Adds the ability for the OWNER to override an item's price on a bill
-- (e.g. give an item at any amount — negotiation, freebie, bulk deal).
--
-- Rules implemented (per product decision):
--   • Owner-only — enforced server-side via public.user_roles, not just
--     hidden in the UI. An employee's client cannot bypass this by
--     calling the RPC directly with a custom_price.
--   • No limit on the custom price (can be ₹0 or anything else).
--   • Custom-priced line items are EXCLUDED from the automatic discount
--     — discount only ever applies to the catalog-priced subtotal.
--   • bill_items.is_custom_price flags which lines were overridden, so
--     invoices / Sales History can show a "Custom" tag.
--
-- Depends on whole_numbers.sql having been run already (or run it
-- first) — this migration fully replaces create_bill() again, this
-- time adding custom pricing on top of the whole-number rounding.
--
-- Safe to re-run.
-- =====================================================================

BEGIN;

ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS is_custom_price boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- Recreate create_bill() with owner-gated custom pricing
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
  v_now              timestamptz := now() at time zone 'Asia/Kolkata';
  v_date             date := v_now::date;
  v_day              text := to_char(v_now, 'FMDay');
  v_time             text := to_char(v_now, 'HH24:MI:SS');
  v_iso              timestamptz := now();
  v_auto_subtotal    numeric(12,0) := 0;
  v_custom_subtotal  numeric(12,0) := 0;
  v_gross            numeric(12,0);
  v_discount         numeric(12,0) := 0;
  v_final            numeric(12,0);
  v_paid             numeric(12,0);
  v_bill_id          uuid := gen_random_uuid();
  v_bill_number      text;
  v_item             jsonb;
  v_inv              public.inventory%rowtype;
  v_qty              integer;
  v_line_total       numeric(12,0);
  v_effective_price  numeric(12,0);
  v_use_custom       boolean;
  v_normalized       jsonb := '[]'::jsonb;
  v_disc_type        text := 'percent';
  v_disc_value       numeric := 10;
  v_disc_min         numeric := 699;
  v_email            text;
  v_role             text;
  v_is_owner         boolean := false;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;

  -- Custom pricing is owner-only — resolved server-side from the JWT,
  -- never trusted from the client payload.
  BEGIN
    v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
  EXCEPTION WHEN OTHERS THEN
    v_email := NULL;
  END;
  IF v_email IS NOT NULL AND to_regclass('public.user_roles') IS NOT NULL THEN
    SELECT role INTO v_role FROM public.user_roles WHERE lower(trim(email)) = lower(trim(v_email));
  END IF;
  v_is_owner := (v_role = 'owner');

  IF to_regclass('public.app_settings') IS NOT NULL THEN
    SELECT COALESCE(value_text,'percent') INTO v_disc_type
      FROM public.app_settings WHERE key = 'discount_type';
    SELECT COALESCE(value_num, 10) INTO v_disc_value
      FROM public.app_settings WHERE key = 'discount_value';
    SELECT COALESCE(value_num, 699) INTO v_disc_min
      FROM public.app_settings WHERE key = 'discount_min_order';
  END IF;

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

    v_use_custom := v_is_owner AND (v_item ->> 'custom_price') IS NOT NULL;
    IF v_use_custom THEN
      v_effective_price := round((v_item->>'custom_price')::numeric, 0);
      IF v_effective_price < 0 THEN
        RAISE EXCEPTION 'Custom price cannot be negative';
      END IF;
    ELSE
      v_effective_price := round(v_inv.price, 0);
    END IF;

    v_line_total := round(v_effective_price * v_qty, 0);
    IF v_use_custom THEN
      v_custom_subtotal := v_custom_subtotal + v_line_total;
    ELSE
      v_auto_subtotal := v_auto_subtotal + v_line_total;
    END IF;

    v_normalized := v_normalized || jsonb_build_object(
      'inv_id', v_inv.id,
      'item_id', v_inv.item_id,
      'item_name', v_inv.item_name,
      'price', v_effective_price,
      'qty', v_qty,
      'line_total', v_line_total,
      'is_custom_price', v_use_custom
    );
  END LOOP;

  v_gross := v_auto_subtotal + v_custom_subtotal;

  -- Discount only ever applies to the catalog-priced (non-custom) subtotal.
  IF v_auto_subtotal > v_disc_min THEN
    IF lower(coalesce(v_disc_type,'percent')) = 'flat' THEN
      v_discount := round(v_disc_value, 0);
    ELSE
      v_discount := round(v_auto_subtotal * (v_disc_value / 100.0), 0);
    END IF;
    IF v_discount > v_auto_subtotal THEN v_discount := v_auto_subtotal; END IF;
  END IF;
  v_final := v_gross - v_discount;

  v_paid := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 0);
  IF v_paid <> v_final THEN
    RAISE EXCEPTION 'Cash + UPI (%) must equal Final Amount (%)', v_paid, v_final;
  END IF;

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
    INSERT INTO public.bill_items(bill_id, inv_id, item_id, item_name, price, qty, line_total, is_custom_price)
    VALUES (
      v_bill_id,
      (v_item->>'inv_id')::uuid,
      v_item->>'item_id',
      v_item->>'item_name',
      (v_item->>'price')::numeric,
      (v_item->>'qty')::int,
      (v_item->>'line_total')::numeric,
      (v_item->>'is_custom_price')::boolean
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
-- Surface is_custom_price through the v_bills_full view so the app can
-- show a "Custom" tag on invoices / Sales History.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_bills_full AS
SELECT
  b.*,
  COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'inv_id', bi.inv_id,
        'item_id', bi.item_id,
        'item_name', bi.item_name,
        'price', bi.price,
        'qty', bi.qty,
        'line_total', bi.line_total,
        'is_custom_price', bi.is_custom_price
      ) ORDER BY bi.id)
     FROM public.bill_items bi WHERE bi.bill_id = b.id),
    '[]'::jsonb
  ) AS items
FROM public.bills b;

GRANT SELECT ON public.v_bills_full TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- DONE. Paste this whole file into Supabase → SQL Editor → Run.
-- (Run whole_numbers.sql first if you haven't already — it contains
-- the earlier decimal-rounding cleanup this migration builds on top of.)
-- =====================================================================
