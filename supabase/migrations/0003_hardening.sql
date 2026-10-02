-- emidost 0003 — security + consistency hardening (audit wave, Claude + Codex).
-- Idempotent. Apply after 0001/0002 (or use 0000_all_in_one.sql which includes this).

-- 1. Fix recursive RLS: actor helpers become SECURITY DEFINER so they read
--    profiles without re-entering its row-level policies (owner bypasses RLS).
create or replace function public.actor_role()
returns text language sql security definer set search_path = public stable as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'none');
$$;
revoke all on function public.actor_role() from public;
grant execute on function public.actor_role() to authenticated, anon;

create or replace function public.actor_retailer()
returns uuid language sql security definer set search_path = public stable as $$
  select retailer_id from public.profiles where id = auth.uid();
$$;
revoke all on function public.actor_retailer() from public;
grant execute on function public.actor_retailer() to authenticated, anon;

-- 2. Atomic credit adjustment (fixes the read-then-write race).
create or replace function public.adjust_credits(rid uuid, d int)
returns int language sql volatile as $$
  update public.retailers set credits_balance = credits_balance + d
   where id = rid and credits_balance + d >= 0
  returning credits_balance;
$$;

-- 3. Partial-payment tracking on schedules.
do $$ begin
  alter table public.emi_schedules add column if not exists amount_paid numeric(12,2) not null default 0;
end $$;

-- 4. Missing tenant/session indexes.
create index if not exists enrollment_sessions_customer_state_idx
  on public.enrollment_sessions (customer_id, state);
create index if not exists enrollment_sessions_retailer_created_idx
  on public.enrollment_sessions (retailer_id, created_at);
create index if not exists profiles_retailer_idx
  on public.profiles (retailer_id);
create index if not exists release_events_customer_idx
  on public.release_events (customer_id);
create index if not exists device_commands_retailer_created_idx
  on public.device_commands (retailer_id, created_at);

-- 5. Constraint tightening.
do $$ begin
  alter table public.emi_schedules add constraint emi_schedules_amount_positive
    check (amount_due > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.credit_ledger add constraint credit_ledger_balance_nonneg
    check (balance_after >= 0);
exception when duplicate_object then null; end $$;
