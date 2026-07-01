-- Iminationz POS — Role-based access migration
-- Run in Supabase SQL Editor. Idempotent.
-- Adds an email-keyed roles table so we can restrict the app view
-- for non-owner employees.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_roles (
  email      text PRIMARY KEY,
  role       text NOT NULL DEFAULT 'employee'
              CHECK (role IN ('owner', 'employee')),
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed the existing admin account as OWNER.
-- Change the email below to your actual owner email if different.
INSERT INTO public.user_roles(email, role, name)
VALUES ('admin@iminationz.app', 'owner', 'Owner')
ON CONFLICT (email) DO UPDATE SET role = 'owner';

-- RLS: any authenticated user can read their own row (needed by the app
-- to know its own role). Only the owner can write.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles read own" ON public.user_roles;
CREATE POLICY "user_roles read own" ON public.user_roles
  FOR SELECT TO authenticated
  USING (email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "user_roles owner writes" ON public.user_roles;
CREATE POLICY "user_roles owner writes" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE email = auth.jwt() ->> 'email' AND role = 'owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE email = auth.jwt() ->> 'email' AND role = 'owner'
    )
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------
-- To add an EMPLOYEE:
-- 1) In Supabase Dashboard → Authentication → Users → "Add user"
--    → Create a new user with any email + password.
-- 2) Come back to SQL Editor and run:
--
--    INSERT INTO public.user_roles(email, role, name)
--    VALUES ('employee@iminationz.app', 'employee', 'Cashier 1')
--    ON CONFLICT (email) DO UPDATE SET role = 'employee';
--
--    (replace the email with the one you created in step 1)
-- ---------------------------------------------------------------
