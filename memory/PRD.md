# Iminationz POS — PRD (Supabase build)

## Overview
Iminationz POS is a mobile-first Expo (React Native) point-of-sale app for a retail jewellery store + pop-up stall. All data and business logic live in **Supabase Postgres**; there is **no FastAPI backend** (the `/app/backend` FastAPI stub is decommissioned — kept only so the platform's supervisor process doesn't crash-loop).

Original repo: `https://github.com/ythkdwvd-Iminationz/IminationzPOS` (imported into this Emergent workspace on 2026-02).

## Stack
- **Frontend:** Expo Router (React Native), TypeScript, `@supabase/supabase-js`
- **Database & Auth:** Supabase (Postgres + Auth) — project `ymktywuhhziuomoshbce`
- **Storage:** none (invoices rendered on-screen; reports exported as XLSX/CSV from client)

## Project Layout
```
/app
├── frontend/         # Expo app
│   └── src/
│       ├── api/
│       │   ├── supabase.ts   # client init
│       │   └── client.ts     # api.* surface (auth, RPC, queries)
│       ├── draft/
│       │   ├── draftBillingStorage.ts / useDraftBilling.ts  # Billing cart draft (pre-existing)
│       │   └── useFormDraft.ts       # NEW generic form-draft hook (2026-02)
│       └── utils/export.ts   # client-side XLSX/CSV exports
├── supabase/
│   ├── schema.sql                        # full schema + RLS + RPC
│   └── migration/
│       ├── billing_config_damaged.sql    # configurable discount + damaged_items feature
│       ├── expenses.sql, exchange.sql, roles.sql, landing_config.sql
│       ├── import_data.sql               # legacy seed data
│       └── whole_numbers.sql             # NEW (2026-02) — user must run manually
├── memory/  (PRD.md, SUPABASE_SETUP.md, test_credentials.md)
└── backend/  # tombstone stub (decommissioned)
```

## Core Features
- Email-OTP login (Supabase Auth) — owner/employee roles via `public.user_roles`
- Dashboard KPI cards (sales, cash, UPI, bills, inventory, low stock)
- POS Billing with customer name + mobile lookup, cart, split Cash+UPI (negative UPI = change)
- Inventory CRUD with cost price + low-stock badge
- Atomic stock deduction via Postgres `create_bill` RPC (single transaction)
- Configurable Discount (percent/flat + min order) — owner-only, editable from Billing gear icon
- Bill Exchange flow (swap a sold item, settle price difference via cash/UPI)
- Damaged Items Tracker (owner-only) — mark damaged, sell at discount or discard
- Expenses tracker — batch entries split personal/business, personal fund allocation
- Sales History with filters/search, Reports (daily + category profit), WhatsApp daily closing, Excel/CSV export

## What's been implemented — 2026-02 session
**Problem reported by user:** (1) `Cash + UPI (877.00) must equal Final Amount (876.80)` error saving bills — wanted whole-number amounts everywhere. (2) App should resume mid-entry forms after being backgrounded/killed, not just the Billing draft.

**Root cause found:** `create_bill()` / `exchange_bill_item()` Postgres RPCs recomputed totals from the raw `inventory.price` (numeric(12,2)) and rounded to 2 decimals server-side, while the frontend already showed whole rupees — any item with a fractional price caused a payment-mismatch error even though the UI never allowed decimal entry.

**Fix delivered:**
- `/app/supabase/migration/whole_numbers.sql` (**user must paste into Supabase SQL Editor and run — NOT auto-applied**): rounds all existing decimal data (inventory, bills, bill_items, damaged_items, expenses, expense_items, exchange_history, app_settings) to whole rupees, and rewrites `create_bill()`, `exchange_bill_item()`, `sell_damaged()` to round every computed amount to 0 decimals so server and client totals can never mismatch again.
- Frontend: fixed remaining `decimal-pad`/`parseFloat` inputs in `inventory.tsx` (price, cost price), `damaged.tsx` (sell price), `expenses.tsx` (child amount, personal/business split, personal fund) → all now `number-pad` + digit-stripped + `parseInt`. Billing screen's cash/UPI inputs were already whole-number (untouched).
- New generic `useFormDraft<T>()` hook (AsyncStorage-backed, debounced auto-save + AppState background flush) wired into: Inventory add/edit item modal, Damaged mark-item modal, Damaged sell-item modal, Expenses batch-entry modal (create + edit), Billing Discount-Settings modal. Each now auto-saves while open and silently reopens with the exact in-progress values if the app is killed/backgrounded mid-entry — matching the Billing cart draft behavior that already existed.

**Known blocker (not part of this session's bug, flagged to user):** Testing agent found Supabase now returns `"Signups not allowed for otp"` when requesting a login code for `admin@iminationz.app` — this account may no longer exist / need re-provisioning in the `ymktywuhhziuomoshbce` Supabase project's Auth users. Nothing in the app can be tested end-to-end until this is resolved.

## Setup (one-time, for the user)
1. Run `/app/supabase/migration/whole_numbers.sql` in Supabase SQL Editor (new, required to actually fix the reported bug).
2. Confirm `admin@iminationz.app` exists under Supabase → Authentication → Users (create/re-invite if the "Signups not allowed for otp" error persists).
3. See `/app/memory/SUPABASE_SETUP.md` for the original full schema setup.

## Security Model
- Client uses **only** the anon public key (`/app/frontend/.env`).
- RLS: `to authenticated using (true)` — signed-in users have full CRUD, anonymous none.
- RPCs run `security invoker`, re-validate stock with conditional `UPDATE … WHERE current_qty >= qty`.
- `service_role` key is never stored in this repo — the user runs all DDL/migration SQL themselves.

## What's been implemented — 2026-02 session (cont'd): Owner Custom Pricing
**Feature:** Owner can override any cart item's price to any whole-number amount (e.g. negotiated deals, freebies). Employees cannot access this. Custom-priced lines are excluded from the automatic discount (discount only applies to the catalog-priced subtotal). Invoices/receipts show a "Custom" tag on overridden lines.

**Delivered:**
- `/app/supabase/migration/custom_pricing.sql` (**user must run in Supabase SQL Editor — run `whole_numbers.sql` first if not already done**): adds `bill_items.is_custom_price`, rewrites `create_bill()` to accept an optional `custom_price` per item, enforced **owner-only server-side** via `public.user_roles` (never trusted from the client), splits gross into auto/custom subtotals, applies discount only to the auto subtotal, and surfaces `is_custom_price` through `v_bills_full`.
- Billing screen: owner-only "price tag" icon per cart line opens a small modal to set/reset a custom price; a "Custom" badge shows on overridden lines; bill summary shows a note when custom-priced items are excluded from the discount.
- Invoice screen (`/app/frontend/app/invoice/[id].tsx`): "Custom" tag shown on-screen, in the printed HTML receipt, and in the shared PDF for any custom-priced line.
- Security fix from code review: an owner's in-progress custom-priced draft could previously be inherited by an employee logging in on the same shared device, causing a blocked checkout. Fixed by stripping `customPrice` from restored drafts unless the current session is confirmed `owner`.

## What's been implemented — 2026-02 session (cont'd): Damaged categories bug + Stock Add/Remove
**Problem reported by user:** (1) On the Damaged Items screen's "Mark as Damaged" item picker, not all categories were visible/reachable (especially Rings). (2) Wanted a way to add new stock in Inventory that increases both Opening Qty and Current Qty together (e.g. Open 20 + Current 15, add 10 → Open 30, Current 25).

**Root cause (damaged categories):** `/app/frontend/app/(tabs)/damaged.tsx`'s item picker had no category filter and hard-capped the list to `filteredInventory.slice(0, 12)`. Inventory is sorted alphabetically by category — any category (like "Ring") beyond the first 12 in-stock items across earlier categories never appeared.

**Fix delivered:**
- `damaged.tsx`: Added the same horizontal category-chip filter used in Inventory to the "Select Item" picker (`invCategories` derived from in-stock inventory, `invCategory` state, chips testID `damaged-category-chip-{category}`), and removed the 12-item cap so all matching items render/scroll.
- `inventory.tsx`: Added an "Add / Remove Stock" box inside the existing Edit Item form (visible only when editing). Toggle chips (`stock-adjust-mode-add` / `stock-adjust-mode-remove`) + qty input (`stock-adjust-qty-input`) + Apply button (`apply-stock-adjustment`). Applying adds/subtracts the entered qty from **both** Opening Qty and Current Qty fields (Remove is blocked if qty exceeds current stock). Setting an exact value is still possible by directly typing into Opening/Current Qty fields (unchanged). No adjustment history log, per user's choice.
- Restored `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `/app/frontend/.env` (repo cloned fresh into this workspace from GitHub; anon key provided by user).

**Known blocker (pre-existing, confirmed still present, out of scope for this session):** Supabase OTP login for `admin@iminationz.app` returns `422 otp_disabled — "Signups not allowed for otp"` (verified via direct Auth API call). This blocks any UI login, so full in-app testing (by both the agent and the user) is stuck at the login screen until the user re-provisions/confirms the account in Supabase → Authentication → Users.

## Prioritized backlog / next steps
- **P0:** Fix the Supabase OTP login blocker (`otp_disabled` for admin@iminationz.app) — re-create/confirm the user in Supabase Authentication so the app can actually be logged into and tested.
- **P0:** User must run `whole_numbers.sql` (if not already) then `custom_pricing.sql` in Supabase SQL Editor.
- **P1:** Consider adding a lightweight "restored draft" banner on Inventory/Expenses/Damaged (Billing already has one) so staff know why a form reopened pre-filled.
- **P2:** Employee-role test account + documented employee permissions matrix.
