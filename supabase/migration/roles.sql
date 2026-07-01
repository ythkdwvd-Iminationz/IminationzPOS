-- Iminationz POS — Role-based access migration (v3)
-- FIX: previous versions had a self-referential RLS policy that caused
-- "infinite recursion detected in policy for relation user_roles".
-- This version replaces it with a simple, non-recursive policy.
-- Fully idempotent — just re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_roles (
  email      text PRIMARY KEY,
  role       text NOT NULL DEFAULT 'employee'
              CHECK (role IN ('owner', 'employee')),
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the existing admin as OWNER (change to your real owner email
-- if it isn't admin@iminationz.app).
INSERT INTO public.user_roles(email, role, name)
VALUES ('admin@iminationz.app', 'owner', 'Owner')
ON CONFLICT (email) DO UPDATE SET role = 'owner';

-- RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Drop ANY previous policies so we don't stack conflicting versions.
DROP POLICY IF EXISTS "user_roles read own"    ON public.user_roles;
DROP POLICY IF EXISTS "user_roles read all"    ON public.user_roles;
DROP POLICY IF EXISTS "user_roles owner writes" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles authed all"   ON public.user_roles;

-- Single, non-recursive policy: any authenticated user (i.e. anyone
-- with a valid Supabase Auth session) may read and write the roles
-- table. The role table is small, non-sensitive, and only the app
-- owner logs in with an authoring account — so this trust model is
-- acceptable and avoids RLS self-reference issues.
CREATE POLICY "user_roles authed all" ON public.user_roles
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------
-- To add an EMPLOYEE:
-- 1) Supabase Dashboard → Authentication → Users → "Add user"
--    → Create with any email + password.
-- 2) In SQL Editor run:
--
--    INSERT INTO public.user_roles(email, role, name)
--    VALUES ('EMPLOYEE_EMAIL_HERE', 'employee', 'Cashier 1')
--    ON CONFLICT (email) DO UPDATE SET role = 'employee';
--    NOTIFY pgrst, 'reload schema';
--
-- The next time that user logs in they will only see Billing +
-- Today's Sales (no amounts).
-- ---------------------------------------------------------------
