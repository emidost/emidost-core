-- emidost 0017 - owner sales ledger (the owner sells locks/credits to retailers).
-- Business model: the owner records a sale of N locks at a price to a retailer,
-- grants device credits in that sale, and the money state lives here —
-- how much sold, at what price, to which retailer, how much paid. Granting
-- credit goes through the SAME atomic RPCs the rest of the system uses, and
-- the ledger rows carry sale_id so every balance change traces back to its
-- invoice. Staff can read their own retailer's purchases; the owner has full
-- access via the JWT claim; the service role is unaffected.
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

alter type public.ledger_kind add value if not exists 'sale';

create table if not exists public.retailer_sales (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id) on delete cascade,
  owner_id uuid references public.profiles(id),
  units int not null check (units > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  total_amount numeric(10,2) not null,
  amount_paid numeric(10,2) not null default 0 check (amount_paid >= 0),
  credits_granted int not null default 0 check (credits_granted >= 0),
  payment_mode text not null default 'cash' check (payment_mode in ('cash','upi','bank','card','credit')),
  note text,
  invoice_no text,
  created_at timestamptz not null default now()
);

create index if not exists retailer_sales_retailer_created_idx
  on public.retailer_sales (retailer_id, created_at desc);
create index if not exists retailer_sales_created_idx
  on public.retailer_sales (created_at desc);
create unique index if not exists retailer_sales_invoice_uidx
  on public.retailer_sales (invoice_no) where invoice_no is not null;

do $$ begin
  alter table public.credit_ledger add column if not exists sale_id uuid references public.retailer_sales(id) on delete set null;
exception when duplicate_column then null; end $$;

-- Bulk allowance grant (one RPC instead of N +1 calls per sale).
create or replace function public.add_lock_allowances(rid uuid, n int)
returns int language sql volatile as $$
  update public.retailers set lock_allowances = lock_allowances + n
   where id = rid
  returning lock_allowances;
$$;

-- Bulk allowance reversal for rollback (never goes below zero).
create or replace function public.sub_lock_allowances(rid uuid, n int)
returns int language sql volatile as $$
  update public.retailers set lock_allowances = lock_allowances - n
   where id = rid and lock_allowances >= n
  returning lock_allowances;
$$;

alter table public.retailer_sales enable row level security;

drop policy if exists retailer_sales_owner on public.retailer_sales;
create policy retailer_sales_owner on public.retailer_sales for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

drop policy if exists retailer_sales_staff_read on public.retailer_sales;
create policy retailer_sales_staff_read on public.retailer_sales for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
         and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
         and not exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.is_suspended));
