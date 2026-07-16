-- =====================================================================
-- Iminationz POS — Billing Config (configurable discount) + Damaged Items
-- Run this file in the Supabase SQL Editor. Idempotent.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Billing config (stored in app_settings)
--    Keys:
--      discount_type       -> 'percent' | 'flat'
--      discount_value      -> number  (10 for 10%, or 100 for ₹100)
--      discount_min_order  -> number  (min gross to activate discount)
-- ---------------------------------------------------------------------

INSERT INTO public.app_settings(key, value_num, value_text)
VALUES
  ('discount_type', NULL, 'percent'),
  ('discount_value', 10, NULL),
  ('discount_min_order', 699, NULL)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Damaged items table
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.damaged_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inv_id            uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
  item_id           text NOT NULL,
  item_name         text NOT NULL,
  category          text,
  qty               integer NOT NULL CHECK (qty > 0),
  unit_price        numeric(12,2) NOT NULL DEFAULT 0,
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','discarded')),
  sold_price        numeric(12,2),
  sold_at           timestamptz,
  sold_note         text,
  damaged_at        timestamptz NOT NULL DEFAULT now(),
  damaged_by_email  text
);

CREATE INDEX IF NOT EXISTS idx_damaged_status    ON public.damaged_items(status);
CREATE INDEX IF NOT EXISTS idx_damaged_at        ON public.damaged_items(damaged_at DESC);
CREATE INDEX IF NOT EXISTS idx_damaged_inv       ON public.damaged_items(inv_id);

ALTER TABLE public.damaged_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "damaged authed all" ON public.damaged_items;
CREATE POLICY "damaged authed all" ON public.damaged_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 3. RPC: mark_damaged
--    Deducts qty from inventory.current_qty and inserts damaged row.
--    Atomic (single transaction inside the function).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_damaged(
  p_inv_id  uuid,
  p_qty     integer,
  p_reason  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_inv     public.inventory%rowtype;
  v_id      uuid := gen_random_uuid();
  v_email   text := coalesce((auth.jwt() ->> 'email'), NULL);
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be > 0';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT * INTO v_inv FROM public.inventory WHERE id = p_inv_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found';
  END IF;
  IF v_inv.current_qty < p_qty THEN
    RAISE EXCEPTION 'Only % in stock for %', v_inv.current_qty, v_inv.item_name;
  END IF;

  UPDATE public.inventory
     SET current_qty  = current_qty - p_qty,
         last_updated = now()
   WHERE id = p_inv_id
     AND current_qty >= p_qty;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stock changed for %, please retry', v_inv.item_name;
  END IF;

  INSERT INTO public.damaged_items(
    id, inv_id, item_id, item_name, category, qty, unit_price, reason,
    status, damaged_at, damaged_by_email
  ) VALUES (
    v_id, v_inv.id, v_inv.item_id, v_inv.item_name, v_inv.category,
    p_qty, v_inv.price, btrim(p_reason),
    'in_stock', now(), v_email
  );

  RETURN jsonb_build_object('id', v_id, 'item_name', v_inv.item_name, 'qty', p_qty);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_damaged(uuid, integer, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 4. RPC: sell_damaged / discard_damaged
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sell_damaged(
  p_damaged_id  uuid,
  p_sold_price  numeric,
  p_note        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row public.damaged_items%rowtype;
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

  UPDATE public.damaged_items
     SET status     = 'sold',
         sold_price = p_sold_price,
         sold_at    = now(),
         sold_note  = nullif(btrim(coalesce(p_note,'')),'')
   WHERE id = p_damaged_id;

  RETURN jsonb_build_object('id', p_damaged_id, 'status', 'sold');
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_damaged(uuid, numeric, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.discard_damaged(
  p_damaged_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row public.damaged_items%rowtype;
BEGIN
  SELECT * INTO v_row FROM public.damaged_items WHERE id = p_damaged_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damaged entry not found';
  END IF;
  IF v_row.status <> 'in_stock' THEN
    RAISE EXCEPTION 'Damaged entry already % ', v_row.status;
  END IF;

  UPDATE public.damaged_items
     SET status  = 'discarded',
         sold_at = now()
   WHERE id = p_damaged_id;

  RETURN jsonb_build_object('id', p_damaged_id, 'status', 'discarded');
END;
$$;

GRANT EXECUTE ON FUNCTION public.discard_damaged(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Update create_bill RPC to use configurable discount
--    Reads discount_type / discount_value / discount_min_order from
--    app_settings on every invocation so changes take effect immediately.
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
  v_gross       numeric(12,2) := 0;
  v_discount    numeric(12,2) := 0;
  v_final       numeric(12,2);
  v_paid        numeric(12,2);
  v_bill_id     uuid := gen_random_uuid();
  v_bill_number text;
  v_item        jsonb;
  v_inv         public.inventory%rowtype;
  v_qty         integer;
  v_line_total  numeric(12,2);
  v_normalized  jsonb := '[]'::jsonb;
  v_disc_type   text := 'percent';
  v_disc_value  numeric := 10;
  v_disc_min    numeric := 699;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Bill must contain at least one item';
  END IF;

  -- Load current discount configuration from app_settings.
  SELECT COALESCE(value_text,'percent') INTO v_disc_type
    FROM public.app_settings WHERE key = 'discount_type';
  SELECT COALESCE(value_num, 10) INTO v_disc_value
    FROM public.app_settings WHERE key = 'discount_value';
  SELECT COALESCE(value_num, 699) INTO v_disc_min
    FROM public.app_settings WHERE key = 'discount_min_order';

  -- Validate stock & compute gross
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
    v_line_total := round(v_inv.price * v_qty, 2);
    v_gross := v_gross + v_line_total;
    v_normalized := v_normalized || jsonb_build_object(
      'inv_id', v_inv.id,
      'item_id', v_inv.item_id,
      'item_name', v_inv.item_name,
      'price', v_inv.price,
      'qty', v_qty,
      'line_total', v_line_total
    );
  END LOOP;

  -- Discount rule: percent or flat, only when gross > min order
  IF v_gross > v_disc_min THEN
    IF lower(coalesce(v_disc_type,'percent')) = 'flat' THEN
      v_discount := round(v_disc_value, 2);
    ELSE
      v_discount := round(v_gross * (v_disc_value / 100.0), 2);
    END IF;
    IF v_discount > v_gross THEN v_discount := v_gross; END IF;
  END IF;
  v_final := round(v_gross - v_discount, 2);

  -- Payment validation
  v_paid := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 2);
  IF abs(v_paid - v_final) > 0.01 THEN
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
    coalesce(p_cash_amount,0), coalesce(p_upi_amount,0),
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

COMMIT;

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
