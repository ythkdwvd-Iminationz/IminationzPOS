# Iminationz POS — PRD (Supabase build)

## Overview
Iminationz POS is a mobile-first Expo (React Native) point-of-sale app for a retail jewellery store + pop-up stall. All data and business logic now live in **Supabase Postgres**; there is **no FastAPI backend**.

## Stack
- **Frontend:** Expo Router (React Native), TypeScript, `@supabase/supabase-js`
- **Database & Auth:** Supabase (Postgres + Auth)
- **Storage:** none (invoices rendered on-screen; reports exported as XLSX/CSV from client)

## Project Layout
```
/app
├── frontend/         # Expo app
│   └── src/
│       ├── api/
│       │   ├── supabase.ts   # client init
│       │   └── client.ts     # api.* surface (auth, RPC, queries)
│       └── utils/
│           └── export.ts     # client-side XLSX/CSV exports
├── supabase/
│   ├── schema.sql                  # full schema + RLS + RPC
│   └── migration/
│       └── import_data.sql         # 10 inventory + 14 bills seed from old build
├── memory/
│   ├── PRD.md                      # ← this file
│   ├── SUPABASE_SETUP.md           # step-by-step setup guide
│   └── test_credentials.md
└── backend/         # ⚠ tombstone stub (decommissioned)
```

## Features Preserved
- Admin login (Supabase email/password) — `admin@iminationz.app` / `admin123`
- Dashboard KPI cards (sales, cash, UPI, bills, inventory, low stock)
- POS-style Billing with customer name + mobile, customer recognition badge
- Inventory CRUD with cost price + low-stock badge
- Atomic stock deduction via Postgres `create_bill` RPC (single transaction)
- Discount rule: **10% above ₹699** (unchanged)
- Split Cash + UPI with **negative UPI for change return**
- Bill numbering `BILL-YYYYMMDD-NNN`
- Sales History with date filters and search
- Reports — daily + category profit (uses cost price)
- WhatsApp Daily Closing — pre-filled `wa.me` links for both owners (9044625875 / 8188996721)
- Excel + CSV exports — generated client-side, open natively in Excel
- Bills are read-only after PAID (no edit endpoints exist)

## Setup (one-time)
See `/app/memory/SUPABASE_SETUP.md`. TL;DR:
1. Paste `/app/supabase/schema.sql` into the Supabase SQL Editor → Run.
2. Auth → Users → Create user `admin@iminationz.app` / `admin123` (auto-confirm).
3. (Optional) Paste `/app/supabase/migration/import_data.sql` to restore the 10+14 records from the legacy build.

## Security Model
- The client uses **only** the anon public key (in `/app/frontend/.env`).
- Row Level Security: `to authenticated using (true)` on all tables — signed-in admin has full CRUD, anonymous users have none.
- The `create_bill` RPC runs `security invoker` and re-validates stock with a conditional `UPDATE … WHERE current_qty >= qty`, so a malicious client cannot induce negative stock.
- `service_role` key is **never** stored in this repo; the user runs migration SQL themselves.
