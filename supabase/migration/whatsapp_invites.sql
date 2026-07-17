-- =====================================================================
-- Iminationz POS — WhatsApp community invite tracking
-- ---------------------------------------------------------------------
-- Purpose:
--   • Track which customer mobiles have been sent a WhatsApp community
--     invite so we can auto-open WhatsApp only for NEW customers (won't
--     spam repeat customers).
--   • Store the community invite link in app_settings so it's editable
--     from the app without a code change.
--
-- Depends on: schema.sql (bills, app_settings). Safe to re-run.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Tracking table
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_invites (
  mobile         text PRIMARY KEY,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  sent_by_email  text
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_invites_sent_at
  ON public.whatsapp_invites(sent_at DESC);

ALTER TABLE public.whatsapp_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth full access" ON public.whatsapp_invites;
CREATE POLICY "auth full access" ON public.whatsapp_invites
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 2. Seed the community link into app_settings
--    (user asked us to preload their invite link)
-- ---------------------------------------------------------------------
INSERT INTO public.app_settings(key, value_text, value_num, updated_at)
VALUES (
  'whatsapp_community_link',
  'https://chat.whatsapp.com/DMU6HmjLdQiA0FuQKv1q3v',
  NULL,
  now()
)
ON CONFLICT (key) DO NOTHING;

-- Also seed a boolean-ish setting for "auto-open on complete bill"
-- (owner can toggle from the Contacts screen).
INSERT INTO public.app_settings(key, value_text, value_num, updated_at)
VALUES ('whatsapp_auto_open', 'true', NULL, now())
ON CONFLICT (key) DO NOTHING;

COMMIT;
