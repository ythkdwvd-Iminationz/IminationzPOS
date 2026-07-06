-- =====================================================================
-- Iminationz POS — Exchange feature migration
-- ---------------------------------------------------------------------
-- Fixes: PGRST202 "Could not find the function public.exchange_bill_item
-- (p_bill_id, p_cash_amount, p_new_inv_id, p_new_qty, p_upi_amount) in
-- the schema cache".
--
-- Adds:
--   1. Columns for exchange tracking on `bills` and `inventory`
--   2. `exchange_history` table (+ RLS)
--   3. `exchange_bill_item(...)` RPC used by frontend/src/api/client.ts
--   4. Refreshed `v_bills_full` view exposing new bill columns
--
-- Idempotent — safe to rerun in the Supabase SQL Editor.
-- =====================================================================

-- 1. Extend inventory & bills ----------------------------------------

alter table public.inventory
  add column if not exists exchange_count integer not null default 0;

alter table public.bills
  add column if not exists exchanged_at              timestamptz,
  add column if not exists exchange_count            integer not null default 0,
  add column if not exists last_exchanged_by_email   text,
  add column if not exists last_exchanged_by_role    text
    check (last_exchanged_by_role in ('owner','employee'));

-- 2. exchange_history table ------------------------------------------

create table if not exists public.exchange_history (
  id                  uuid primary key default uuid_generate_v4(),
  bill_id             uuid not null references public.bills(id) on delete cascade,
  bill_number         text not null,
  old_bill_item_id    uuid,
  old_inv_id          uuid,
  old_item_id         text not null,
  old_item_name       text not null,
  old_qty             integer not null,
  old_price           numeric(12,2) not null,
  old_line_total      numeric(12,2) not null,
  new_inv_id          uuid,
  new_item_id         text not null,
  new_item_name       text not null,
  new_qty             integer not null,
  new_price           numeric(12,2) not null,
  new_line_total      numeric(12,2) not null,
  price_diff          numeric(12,2) not null,
  cash_settled        numeric(12,2) not null default 0,
  upi_settled         numeric(12,2) not null default 0,
  exchanged_at        timestamptz not null default now(),
  exchanged_by_email  text,
  exchanged_by_role   text check (exchanged_by_role in ('owner','employee'))
);

create index if not exists idx_exchange_history_bill_id
  on public.exchange_history(bill_id);
create index if not exists idx_exchange_history_exchanged_at
  on public.exchange_history(exchanged_at desc);

alter table public.exchange_history enable row level security;
drop policy if exists "auth full access" on public.exchange_history;
create policy "auth full access" on public.exchange_history
  for all to authenticated using (true) with check (true);

-- 3. Refresh v_bills_full view so new bill columns are exposed --------
--    (b.* automatically picks them up, but re-creating forces PostgREST
--     to refresh its cached column list.)

create or replace view public.v_bills_full as
select
  b.*,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
        'id', bi.id,
        'inv_id', bi.inv_id,
        'item_id', bi.item_id,
        'item_name', bi.item_name,
        'price', bi.price,
        'qty', bi.qty,
        'line_total', bi.line_total
      ) order by bi.id)
     from public.bill_items bi where bi.bill_id = b.id),
    '[]'::jsonb
  ) as items
from public.bills b;

grant select on public.v_bills_full to authenticated;

-- 4. exchange_bill_item RPC ------------------------------------------
--    Signature must match frontend/src/api/client.ts (6 named args).
--    Steps:
--      a. Load old bill_item + old inventory row.
--      b. Load new inventory row, validate stock.
--      c. Return old qty to old-item stock, deduct new qty from new item.
--      d. Bump new item's exchange_count.
--      e. Update the bill_item line in-place (new inv, name, price, qty).
--      f. Recompute bill totals (10% discount when gross > 699).
--      g. Validate cash+upi == price_diff (allow negative for refunds).
--      h. Update bill: totals + cash_amount/upi_amount deltas +
--         exchanged_at, exchange_count, last_exchanged_by_*.
--      i. Insert exchange_history row.

create or replace function public.exchange_bill_item(
  p_bill_id           uuid,
  p_old_bill_item_id  uuid,
  p_new_inv_id        uuid,
  p_new_qty           integer,
  p_cash_amount       numeric,
  p_upi_amount        numeric
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_bill              public.bills%rowtype;
  v_old_line          public.bill_items%rowtype;
  v_old_inv           public.inventory%rowtype;
  v_new_inv           public.inventory%rowtype;
  v_new_line_total    numeric(12,2);
  v_price_diff        numeric(12,2);
  v_settlement        numeric(12,2);
  v_new_gross         numeric(12,2) := 0;
  v_new_discount      numeric(12,2) := 0;
  v_new_final         numeric(12,2);
  v_now               timestamptz := now();
  v_email             text;
  v_role              text;
begin
  if p_new_qty is null or p_new_qty <= 0 then
    raise exception 'Invalid new quantity %', p_new_qty;
  end if;

  -- Bill row (lock to prevent concurrent exchanges on same bill)
  select * into v_bill from public.bills where id = p_bill_id for update;
  if not found then
    raise exception 'Bill % not found', p_bill_id;
  end if;

  -- Old bill_item line
  select * into v_old_line
    from public.bill_items
   where id = p_old_bill_item_id and bill_id = p_bill_id;
  if not found then
    raise exception 'Bill item % not found on bill %', p_old_bill_item_id, p_bill_id;
  end if;

  -- Old inventory (may be null if item deleted — fallback to line data)
  if v_old_line.inv_id is not null then
    select * into v_old_inv from public.inventory where id = v_old_line.inv_id;
  end if;

  -- New inventory
  select * into v_new_inv from public.inventory where id = p_new_inv_id for update;
  if not found then
    raise exception 'New inventory item % not found', p_new_inv_id;
  end if;
  if v_new_inv.current_qty < p_new_qty then
    raise exception 'Insufficient stock for % (available %)',
      v_new_inv.item_name, v_new_inv.current_qty;
  end if;

  v_new_line_total := round(v_new_inv.price * p_new_qty, 2);
  v_price_diff     := round(v_new_line_total - v_old_line.line_total, 2);
  v_settlement     := round(coalesce(p_cash_amount,0) + coalesce(p_upi_amount,0), 2);

  if abs(v_settlement - v_price_diff) > 0.01 then
    raise exception
      'Settlement (cash % + upi % = %) must equal price difference %',
      coalesce(p_cash_amount,0), coalesce(p_upi_amount,0),
      v_settlement, v_price_diff;
  end if;

  -- Return old qty to old inventory (if it still exists)
  if v_old_inv.id is not null then
    update public.inventory
       set current_qty  = current_qty + v_old_line.qty,
           sold_qty     = greatest(sold_qty - v_old_line.qty, 0),
           last_updated = v_now
     where id = v_old_inv.id;
  end if;

  -- Deduct new qty from new inventory + bump exchange_count
  update public.inventory
     set current_qty    = current_qty - p_new_qty,
         sold_qty       = sold_qty + p_new_qty,
         exchange_count = exchange_count + 1,
         last_updated   = v_now
   where id = v_new_inv.id
     and current_qty >= p_new_qty;
  if not found then
    raise exception 'Stock changed for %, please retry', v_new_inv.item_name;
  end if;

  -- Replace the bill_item line in place
  update public.bill_items
     set inv_id     = v_new_inv.id,
         item_id    = v_new_inv.item_id,
         item_name  = v_new_inv.item_name,
         price      = v_new_inv.price,
         qty        = p_new_qty,
         line_total = v_new_line_total
   where id = p_old_bill_item_id;

  -- Recompute bill gross from remaining line items
  select coalesce(sum(line_total), 0) into v_new_gross
    from public.bill_items where bill_id = p_bill_id;

  if v_new_gross > 699 then
    v_new_discount := round(v_new_gross * 0.10, 2);
  else
    v_new_discount := 0;
  end if;
  v_new_final := round(v_new_gross - v_new_discount, 2);

  -- Identify the actor (best-effort — RLS still enforces the auth check)
  begin
    v_email := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'email', '');
  exception when others then
    v_email := null;
  end;
  if v_email is not null then
    select role into v_role from public.user_roles where email = v_email;
  end if;

  -- Update the bill totals & audit fields
  update public.bills
     set gross_amount            = v_new_gross,
         discount                = v_new_discount,
         final_amount            = v_new_final,
         cash_amount             = round(cash_amount + coalesce(p_cash_amount,0), 2),
         upi_amount              = round(upi_amount  + coalesce(p_upi_amount,0),  2),
         exchanged_at            = v_now,
         exchange_count          = coalesce(exchange_count,0) + 1,
         last_exchanged_by_email = v_email,
         last_exchanged_by_role  = v_role
   where id = p_bill_id;

  -- Insert exchange_history row
  insert into public.exchange_history(
    bill_id, bill_number,
    old_bill_item_id, old_inv_id,
    old_item_id, old_item_name, old_qty, old_price, old_line_total,
    new_inv_id, new_item_id, new_item_name, new_qty, new_price, new_line_total,
    price_diff, cash_settled, upi_settled,
    exchanged_at, exchanged_by_email, exchanged_by_role
  ) values (
    p_bill_id, v_bill.bill_number,
    p_old_bill_item_id, v_old_line.inv_id,
    v_old_line.item_id, v_old_line.item_name, v_old_line.qty,
    v_old_line.price, v_old_line.line_total,
    v_new_inv.id, v_new_inv.item_id, v_new_inv.item_name, p_new_qty,
    v_new_inv.price, v_new_line_total,
    v_price_diff,
    coalesce(p_cash_amount,0), coalesce(p_upi_amount,0),
    v_now, v_email, v_role
  );

  return jsonb_build_object(
    'bill_id',              p_bill_id,
    'old_item_name',        v_old_line.item_name,
    'new_item_name',        v_new_inv.item_name,
    'price_diff',           v_price_diff,
    'settlement_collected', v_settlement,
    'new_gross_amount',     v_new_gross,
    'new_discount',         v_new_discount,
    'new_final_amount',     v_new_final,
    'exchanged_at',         v_now
  );
end;
$$;

grant execute on function public.exchange_bill_item(uuid, uuid, uuid, integer, numeric, numeric)
  to authenticated;

-- Drop older/wrong overloads if they exist (prevents PostgREST ambiguity)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'exchange_bill_item'
       and p.oid::regprocedure::text <>
           'exchange_bill_item(uuid,uuid,uuid,integer,numeric,numeric)'
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Ask PostgREST to reload its schema cache immediately
notify pgrst, 'reload schema';

-- =====================================================================
-- DONE. In Supabase → SQL Editor → paste this whole file → Run.
-- Then retry the exchange from the Sales tab.
-- =====================================================================
