# Iminationz POS — Supabase Setup Guide

The app has been migrated from FastAPI + MongoDB to **Expo + Supabase only**.
This document is the single source of truth for setting up the database.

## 1. Run the schema

1. Open the Supabase Dashboard for your project
   (`https://supabase.com/dashboard/project/ymktywuhhziuomoshbce`).
2. Go to **SQL Editor → New query**.
3. Paste the **entire** contents of [`/app/supabase/schema.sql`](../supabase/schema.sql) and click **Run**.

This creates:

| Object | What it does |
|---|---|
| `public.inventory`, `public.bills`, `public.bill_items` | Core tables |
| Indexes on category / date / iso / bill_number / mobile | Fast list & filter |
| RLS policies — `to authenticated using (true)` | Signed-in admin has full CRUD; anonymous = no access |
| `public.next_bill_number(date)` | Builds `BILL-YYYYMMDD-NNN` |
| `public.create_bill(...)` RPC | **Atomic** — validates stock, applies 10%-above-₹699 discount, validates Cash+UPI = Final (allows negative UPI), deducts inventory inside one transaction |
| `public.v_bills_full` | View that returns each bill with its items as a JSONB array (used everywhere in the app) |

## 2. Create the admin user

1. Dashboard → **Authentication → Users → Add user → Create new user**.
2. Fill:
   - **Email:** `admin@iminationz.app`
   - **Password:** `admin123`
   - **Auto Confirm User:** ✅ ON
3. Click **Create user**.

To change the password later, the same screen has **Send password recovery** or you can use SQL Editor:
```sql
-- set a new password (run with the dashboard's own SQL editor, which uses service_role)
select auth.update_user('<USER-UUID>', '{"password":"new-password"}'::jsonb);
```

## 3. (Optional) Import existing data

If you want the 10 inventory items + 14 bills that already lived in the FastAPI build, run:

* [`/app/supabase/migration/import_data.sql`](../supabase/migration/import_data.sql) — wrap in BEGIN/COMMIT, ON CONFLICT DO NOTHING, safe to rerun.

Or **skip this step and start fresh** — the Dashboard will show a "Seed Sample Inventory" button if your `inventory` table is empty.

## 4. Environment variables

`/app/frontend/.env` already contains the right values. If you ever rotate the anon key, update only these two lines:

```
EXPO_PUBLIC_SUPABASE_URL=https://ymktywuhhziuomoshbce.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

The **service_role** key is **never** referenced by the client and is not stored in this repository.

## 5. Deployment

Because there is no FastAPI backend anymore:

1. Build the Expo web bundle: `cd /app/frontend && yarn expo export --platform web`.
2. Drop the resulting `dist/` folder onto **Netlify / Vercel / Cloudflare Pages** (or use the Emergent **Publish** button).
3. Make sure the deploy environment also sets `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

For native iOS / Android builds (EAS), the same env vars must be set in your EAS profile.

## 6. What's still in `/app/backend`?

A 20-line stub file. It exists only to keep the platform's supervisor process from crash-looping. **Treat the entire `/app/backend` folder as dead code** — the app does not call it. You can safely ignore it.

## 7. Supabase Storage (not yet used)

Invoices are rendered on-screen and exported as XLSX/CSV from the client. No storage bucket is required for current functionality. If you later want to attach photos to inventory items, create a bucket called `inventory-photos` with RLS like:

```sql
-- Allow authenticated users to read and write
create policy "authenticated read"  on storage.objects for select to authenticated using (bucket_id = 'inventory-photos');
create policy "authenticated write" on storage.objects for insert to authenticated with check (bucket_id = 'inventory-photos');
```
