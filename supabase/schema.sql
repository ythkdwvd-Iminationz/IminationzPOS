-- =====================================================================
-- Iminationz Jewellery POS — Supabase Schema
-- Run this file in the Supabase SQL Editor (Project → SQL → New query)
-- =====================================================================

-- 1. Extensions ------------------------------------------------------
create extension if not exists "uuid-ossp";

-- 2. Tables ----------------------------------------------------------

create table if not exists public.inventory (
  id              uuid primary key default uuid_generate_v4(),
  item_id         text not null unique,
  category        text not null,
  item_name       text not null,
  price           numeric(12,2) not null default 0,
  cost_price      numeric(12,2) not null default 0,
  opening_qty     integer not null default 0,
  current_qty     integer not null default 0 check (current_qty >= 0),
  sold_qty        integer not null default 0,
  created_date    timestamptz not null default now(),
  last_updated    timestamptz not null default now()
);

create table if not exists public.bills (
  id              uuid primary key default uuid_generate_v4(),
  bill_number     text not null unique,
  customer_mobile text,
  customer_name   text,
  date            date not null default (now() at time zone 'Asia/Kolkata')::date,
  day             text not null,
  time            text not null,
  iso             timestamptz not null default now(),
  gross_amount    numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  final_amount    numeric(12,2) not null default 0,
  cash_amount     numeric(12,2) not null default 0,
  upi_amount      numeric(12,2) not null default 0,
  payment_status  text not null default 'PAID',
  created_at      timestamptz not null default now()
);

create table if not exists public.bill_items (
  id          uuid primary key default uuid_generate_v4(),
  bill_id     uuid not null references public.bills(id) on delete cascade,
  inv_id      uuid,
  item_id     text not null,
  item_name   text not null,
  price       numeric(12,2) not null,
  qty         integer not null check (qty > 0),
  line_total  numeric(12,2) not null
);

-- 3. Indexes ---------------------------------------------------------

create index if not exists idx_inventory_category    on public.inventory(category);
create index if not exists idx_inventory_low_stock   on public.inventory(current_qty);
create index if not exists idx_bills_date            on public.bills(date desc);
create index if not exists idx_bills_iso             on public.bills(iso desc);
create index if not exists idx_bills_mobile          on public.bills(customer_mobile);
create index if not exists idx_bills_bill_number     on public.bills(bill_number);
create index if not exists idx_bill_items_bill_id    on public.bill_items(bill_id);
create index if not exists idx_bill_items_item_id    on public.bill_items(item_id);

-- 4. Row Level Security ---------------------------------------------
--  Single-admin app: any signed-in user has full CRUD; anon has none.

alter table public.inventory  enable row level security;
alter table public.bills      enable row level security;
alter table public.bill_items enable row level security;

-- Drop existing policies if rerunning
drop policy if exists "auth full access" on public.inventory;
drop policy if exists "auth full access" on public.bills;
drop policy if exists "auth full access" on public.bill_items;

create policy "auth full access" on public.inventory
  for all to authenticated using (true) with check (true);

create policy "auth full access" on public.bills
  for all to authenticated using (true) with check (true);

create policy "auth full access" on public.bill_items
  for all to authenticated using (true) with check (true);

-- 5. Helper: next bill number ---------------------------------------

create or replace function public.next_bill_number(p_date date)
returns text language plpgsql as $$
declare
  v_prefix text;
  v_count  integer;
begin
  v_prefix := 'BILL-' || to_char(p_date, 'YYYYMMDD') || '-';
  select count(*) into v_count from public.bills where bill_number like v_prefix || '%';
  return v_prefix || lpad((v_count + 1)::text, 3, '0');
end;
$$;

-- 6. ATOMIC create_bill RPC -----------------------------------------
--  Validates stock, deducts inventory, applies discount, inserts bill+items.
--  Called from client: supabase.rpc('create_bill', {...}).

create or replace function public.create_bill(
  p_customer_mobile text,
  p_customer_name   text,
  p_items           jsonb,           -- [{inv_id, qty}]
  p_cash_amount     numeric,
  p_upi_amount      numeric
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_now         timestamptz := now() at time zone 'Asia/Kolkata';
  v_date        date := v_now::date;
  v_day         text := to_char(v_now, 'FMDay');
  v_time        text := to_char(v_now, 'HH24:MI:SS');
  v_iso         timestamptz := now();
  v_gross       numeric(12,2) := 0;
  v_discount    numeric(12,2) := 0;
  v_final       numeric(12,2);
  v_paid        numeric(12,2);
  v_bill_id     uuid := uuid_generate_v4();
  v_bill_number text;
  v_item        jsonb;
  v_inv         public.inventory%rowtype;
  v_qty         integer;
  v_line_total  numeric(12,2);
  v_normalized  jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Bill must contain at least one item';
  end if;

  -- Validate stock & compute gross
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'qty')::int;
    if v_qty <= 0 then
      raise exception 'Invalid qty %', v_qty;
    end if;
    select * into v_inv from public.inventory where id = (v_item->>'inv_id')::uuid;
    if not found then
      raise exception 'Item % not found', v_item->>'inv_id';
    end if;
    if v_inv.current_qty < v_qty then
      raise exception 'Insufficient stock for % (available %)', v_inv.item_name, v_inv.current_qty;
    end if;
    v_line_total := round(v_inv.price * v_qty, 2);
    v_gross := v_gross + v_line_total;
    v_normalized := v_normalized || jsonb_build_object(
      'inv_id', v_inv.id,
      'item_id', v_inv.item_id,
      'item_name', v_inv.item_name,
      'price', v_inv.price,
      'qty', v_qty,
      'line_total', v_line_total
    );
  end loop;

  -- Discount rule: 10% only when gross > 699
  if v_gross > 699 then
    v_discount := round(v_gross * 0.10, 2);
  end if;
  v_final := round(v_gross - v_discount, 2);

  -- Payment validation (allows negative UPI for change return)
  v_paid := round(coalesce(p_cash_amount, 0) + coalesce(p_upi_amount, 0), 2);
  if abs(v_paid - v_final) > 0.01 then
    raise exception 'Cash + UPI (%) must equal Final Amount (%)', v_paid, v_final;
  end if;

  -- Deduct inventory atomically (function runs in a single transaction)
  for v_item in select * from jsonb_array_elements(v_normalized)
  loop
    v_qty := (v_item->>'qty')::int;
    update public.inventory
       set current_qty = current_qty - v_qty,
           sold_qty    = sold_qty + v_qty,
           last_updated = now()
     where id = (v_item->>'inv_id')::uuid
       and current_qty >= v_qty;
    if not found then
      raise exception 'Stock changed for %, please retry', v_item->>'item_name';
    end if;
  end loop;

  -- Bill number
  v_bill_number := public.next_bill_number(v_date);

  insert into public.bills(
    id, bill_number, customer_mobile, customer_name, date, day, time, iso,
    gross_amount, discount, final_amount, cash_amount, upi_amount, payment_status
  ) values (
    v_bill_id, v_bill_number,
    nullif(trim(coalesce(p_customer_mobile,'')),''),
    nullif(trim(coalesce(p_customer_name,'')),''),
    v_date, v_day, v_time, v_iso,
    v_gross, v_discount, v_final,
    coalesce(p_cash_amount,0), coalesce(p_upi_amount,0),
    'PAID'
  );

  -- Insert line items
  for v_item in select * from jsonb_array_elements(v_normalized)
  loop
    insert into public.bill_items(bill_id, inv_id, item_id, item_name, price, qty, line_total)
    values (
      v_bill_id,
      (v_item->>'inv_id')::uuid,
      v_item->>'item_id',
      v_item->>'item_name',
      (v_item->>'price')::numeric,
      (v_item->>'qty')::int,
      (v_item->>'line_total')::numeric
    );
  end loop;

  return jsonb_build_object(
    'id', v_bill_id,
    'bill_number', v_bill_number,
    'gross_amount', v_gross,
    'discount', v_discount,
    'final_amount', v_final
  );
end;
$$;

grant execute on function public.create_bill(text, text, jsonb, numeric, numeric) to authenticated;

-- 7. Convenience view: bills with items embedded ---------------------

create or replace view public.v_bills_full as
select
  b.*,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
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

-- =====================================================================
-- DONE. Next:
--   1. Create the admin user in Auth → Users → "Invite user" or "Add user":
--        email: admin@iminationz.app
--        password: admin123
--        ✅ Auto-confirm user
--   2. (Optional) Run /app/supabase/migration/import_data.sql to load
--      the existing 10 inventory items and 14 bills from the FastAPI build.
-- =====================================================================
