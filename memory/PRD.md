# Iminationz Jewellery POS — PRD

## Overview
Iminationz POS is a mobile-first Expo (React Native) point-of-sale app for a retail jewellery store and pop-up stall. Optimized for counter billing (30–60 seconds per bill), single-admin use, currency ₹ (INR).

## Stack
- Frontend: Expo Router (React Native), TypeScript
- Backend: FastAPI + Motor (MongoDB)
- Auth: Simple admin username/password (admin/admin123), bearer token

## Features
- **Admin login** (admin/admin123)
- **Dashboard**: Today's sales hero card + KPI grid (Cash, UPI, Items sold, Discount, Stock Qty, Low-stock count). Quick "New Bill" CTA & seed button when empty.
- **Billing (POS-style)**: customer mobile (optional), Add Item modal with search, qty +/- with stock validation (no overselling), auto gross/discount (10% if gross > ₹699), final amount, split Cash/UPI inputs (negative UPI allowed for change return), live PAID/DRAFT status badge, Complete Bill button enabled only when Cash + UPI == Final.
- **Inventory**: Add/Edit/Delete, search, horizontal scrollable category chips, red "Low Stock" badge when qty ≤ 5.
- **Sales History**: filters (Today / Yesterday / Month / All), search by bill no or mobile, opens invoice on tap.
- **Reports**: Daily sales summary + Inventory summary + Low Stock list.
- **Invoice**: Printable receipt-style screen (white background), share/PDF, print (web window.print).
- **Bill locking**: bills are persisted with status PAID and no edit endpoints exist (read-only by design).
- **Atomic inventory deduction**: $inc with conditional `current_qty >= qty` guard prevents oversell. Rolls back on partial failure.

## API (prefix `/api`)
| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/login` | username + password → token |
| GET / POST / PUT / DELETE | `/inventory[/{id}]` | CRUD inventory |
| POST | `/bills` | create bill (validates stock, deducts inventory) |
| GET | `/bills` | list with filter (today/yesterday/month/custom/all) + search |
| GET | `/bills/{id}` | fetch single bill |
| GET | `/dashboard/today` | KPI snapshot |
| GET | `/reports/daily?date=YYYY-MM-DD` | daily report |
| GET | `/reports/inventory` | inventory report (incl. low stock list) |
| POST | `/seed` | seed 10 sample items (idempotent) |

## Discount Rule
`if gross > 699 → discount = 10% of gross`, else 0. Applied automatically on bill create.

## Payment Validation
`cash_amount + upi_amount` must equal `final_amount` (tolerance 0.01). UPI can be negative (change returned via UPI).

## Out of scope (this iteration)
- Multi-user / role-based auth
- Cloud printing / actual PDF generation (uses native Share + window.print fallback)
- CSV export (visible in Reports UI but not yet generated as a file)
