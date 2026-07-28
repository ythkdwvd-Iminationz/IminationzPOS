-- Iminationz POS — Day Open/Closed tracking migration
-- Run this in Supabase SQL Editor once. Idempotent.
-- If the app still says "Could not find the table" after running this,
-- run the final NOTIFY statement (at the bottom) again on its own — it
-- tells PostgREST to reload its schema cache.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One row per calendar day: whether the shop was opened or kept closed.
-- Shared across all devices/logins — the popup on any device checks/writes
-- here so "today's" answer is consistent no matter which phone is used.
CREATE TABLE IF NOT EXISTS public.day_status (
  day_date    date PRIMARY KEY,
  status      text NOT NULL CHECK (status IN ('open', 'closed')),
  set_by      text,               -- email of whoever answered the popup
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.day_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "day_status authed all" ON public.day_status;
CREATE POLICY "day_status authed all" ON public.day_status
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
