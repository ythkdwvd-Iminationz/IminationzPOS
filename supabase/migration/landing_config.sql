-- =====================================================================
-- Iminationz — landing_config table
-- ---------------------------------------------------------------------
-- Powers the standalone landing page in /landing (deployed on Netlify).
-- Simple key/value store so the owner can edit any link from the POS
-- app (or the Supabase Table Editor) without redeploying the site.
--
-- Read: public (anon + authenticated) — this is a PUBLIC landing page.
-- Write: authenticated users only (i.e. the POS admin).
--
-- Idempotent — safe to rerun in the Supabase SQL Editor.
-- =====================================================================

create table if not exists public.landing_config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.landing_config enable row level security;

drop policy if exists "landing_config public read"  on public.landing_config;
drop policy if exists "landing_config auth write"   on public.landing_config;

create policy "landing_config public read" on public.landing_config
  for select to anon, authenticated using (true);

create policy "landing_config auth write" on public.landing_config
  for all to authenticated using (true) with check (true);

-- Seed defaults (edit values in the Table Editor after running once)
insert into public.landing_config(key, value) values
  ('instagram_url',         'https://instagram.com/iminationz'),
  ('store_location_url',    'https://maps.google.com/?q=Iminationz'),
  ('whatsapp_community_url','https://chat.whatsapp.com/'),
  ('upi_url',               'upi://pay?pa=iminationz@upi&pn=Iminationz&cu=INR'),
  ('shop_via_dm_url',       'https://ig.me/m/iminationz'),
  ('latest_collection_url', 'https://instagram.com/iminationz')
on conflict (key) do nothing;

-- Nudge PostgREST
notify pgrst, 'reload schema';
