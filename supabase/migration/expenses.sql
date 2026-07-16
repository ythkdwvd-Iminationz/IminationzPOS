-- Iminationz POS — Expenses feature migration
-- Run this in Supabase SQL Editor once. Idempotent.
-- If the app still says "Could not find the table" after running this,
-- run the final NOTIFY statement (at the bottom) again on its own — it
-- tells PostgREST to reload its schema cache.

BEGIN;

-- gen_random_uuid() lives in pgcrypto (already enabled on Supabase, but
-- be defensive so this file also works on plain Postgres).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Key/value settings table (holds personal_fund_total etc.)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value_num   numeric,
  value_text  text,
  updated_at  timestamptz DEFAULT now()
);

-- Seed personal fund default: ₹2,00,000
INSERT INTO public.app_settings(key, value_num)
VALUES ('personal_fund_total', 200000)
ON CONFLICT (key) DO NOTHING;

-- Expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date      date        NOT NULL DEFAULT CURRENT_DATE,
  amount            numeric     NOT NULL CHECK (amount >= 0),
  source            text        NOT NULL CHECK (source IN ('personal','business','both')),
  personal_amount   numeric     NOT NULL DEFAULT 0 CHECK (personal_amount >= 0),
  business_amount   numeric     NOT NULL DEFAULT 0 CHECK (business_amount >= 0),
  note              text,
  receipt_base64    text,
  receipt_mime      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date   ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_source ON public.expenses(source);

-- Enable RLS
ALTER TABLE public.expenses     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Full access for authenticated users (single-tenant app)
DROP POLICY IF EXISTS "expenses authed all" ON public.expenses;
CREATE POLICY "expenses authed all" ON public.expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "settings authed all" ON public.app_settings;
CREATE POLICY "settings authed all" ON public.app_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also allow reads to the bills view/table for the summary (the existing
-- `bills` table already has its own policies from the base migration).

-- Aggregated view for quick summaries
CREATE OR REPLACE VIEW public.v_expense_summary AS
SELECT
  COALESCE(SUM(personal_amount), 0)::numeric AS total_personal,
  COALESCE(SUM(business_amount), 0)::numeric AS total_business,
  COALESCE(SUM(amount),          0)::numeric AS total_all,
  COUNT(*)::int AS entries
FROM public.expenses;

COMMIT;

-- Ask PostgREST to refresh its schema cache so /rest/v1/expenses starts
-- working immediately without a wait / restart.
NOTIFY pgrst, 'reload schema';
