-- ============================================================================
-- emidost ALL-IN-ONE (single file). Open a NEW query tab and run this whole file.
-- Contains: schema, indexes, hardening, location, JWT RLS, retention, lock mode, refunds, rate limits, credit lifecycle + atomic payments (0010), rate-limit RLS close (0011), REBOOT command type (0012), FCM wake tokens (0013), customer photos (0014), overdue escalation (0015), REMIND command (0016).
-- Accounts come from scripts/create_accounts.mjs (the SQL editor cannot write auth.users).
-- Idempotent: safe to re-run.
-- ============================================================================
-- emidost 0001 â€" fresh schema for a NEW Supabase project.
-- Idempotent: safe to re-run (to_regclass guards).
-- No secrets: PIN hashes only, token hashes only, audit stores no payload secrets.

begin;

-- â"€â"€ extensions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create extension if not exists pgcrypto;

-- â"€â"€ roles â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
do $$ begin
  create type public.user_role as enum ('owner', 'retailer_staff', 'customer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loan_status as enum ('RUNNING', 'NPA', 'COMPLETE', 'SETTLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.enrolment_state as enum (
    'created', 'prechecked', 'paired', 'connected', 'installed',
    'owner_verified', 'access_verified', 'finalizing', 'active', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.command_type as enum ('LOCK', 'UNLOCK', 'RELEASE', 'DEVICE_ACTION', 'SET_PIN_POLICY');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.command_status as enum ('PENDING', 'RECEIVED', 'EXECUTED', 'SUPERSEDED', 'EXPIRED', 'CANCELLED', 'FAILED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_kind as enum ('topup', 'slot_consumed', 'slot_freed', 'lock_consumed', 'adjust');
exception when duplicate_object then null; end $$;

-- â"€â"€ profiles â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'retailer_staff',
  retailer_id uuid,
  full_name text,
  phone text,
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- â"€â"€ retailers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.retailers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  phone text not null,                -- SMS sender allowlist for offline LOCK/UNLOCK
  credits_balance int not null default 0 check (credits_balance >= 0),
  lock_allowances int not null default 0 check (lock_allowances >= 0),
  is_suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_retailer_fk'
  ) then
    alter table public.profiles
      add constraint profiles_retailer_fk foreign key (retailer_id) references public.retailers(id) on delete set null;
  end if;
end $$;

-- â"€â"€ credit / lock-allowance ledger â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id),
  kind public.ledger_kind not null,
  delta int not null,
  balance_after int not null,
  device_id uuid,
  by_profile uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- â"€â"€ customers / devices â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id),
  name text not null,
  phone text not null,
  imei text not null,
  brand text not null,
  model text not null,
  emi_months int not null check (emi_months > 0),
  emi_amount numeric(12,2) not null check (emi_amount > 0),
  emi_due_day int not null check (emi_due_day between 1 and 31),
  customer_code text unique,           -- SMS command code, PIN/TOTP companion
  status public.loan_status not null default 'RUNNING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid unique references public.customers(id) on delete cascade,
  retailer_id uuid not null references public.retailers(id),
  installation_id text unique not null,
  manufacturer text, model text, os_version text,
  mode text not null default 'none' check (mode in ('none', 'device_admin', 'device_owner')),
  imei text, imsi_baseline text, iccid_baseline text,
  device_pin_hash text,                 -- bcrypt; plaintext never stored or logged
  pin_verify text,                      -- sha256(pin + ":" + installation_id) for offline device checks
  device_token_hash text,               -- sha256 of the device token; raw token never stored
  is_locked boolean not null default false,
  hidden_state text not null default 'visible' check (hidden_state in ('visible', 'hidden')),
  last_heartbeat_at timestamptz,
  consent_record_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  retailer_id uuid not null references public.retailers(id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash',
  receipt_no text,
  reversed_by uuid,
  reversed_at timestamptz,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.emi_schedules (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  retailer_id uuid not null references public.retailers(id),
  due_date date not null,
  amount_due numeric(12,2) not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE')),
  created_at timestamptz not null default now()
);

-- â"€â"€ device commands â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  retailer_id uuid not null references public.retailers(id),
  command_type public.command_type not null,
  payload jsonb not null default '{}'::jsonb,
  status public.command_status not null default 'PENDING',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  acked_at timestamptz,
  executed_at timestamptz
);

create table if not exists public.device_command_acks (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.device_commands(id) on delete cascade,
  ack_status public.command_status not null,
  reason text,
  server_now timestamptz not null default now(),
  received_at timestamptz not null default now()
);

-- â"€â"€ enrolment sessions (consent is a precondition) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  lang text not null default 'en',
  text_hash text not null,
  text_version int not null default 1,
  otp_ack boolean not null default false,
  signature_ref text,
  recorded_by uuid references public.profiles(id),
  recorded_at timestamptz not null default now()
);

create table if not exists public.enrollment_sessions (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers(id),
  customer_id uuid references public.customers(id),
  device_serial text,
  apk_sha256 text,
  token_hash text not null,             -- sha256 of the one-time token; raw token never stored
  consent_record_id uuid,               -- optional: direct counter consent is the business rule; an audit row may reference one
  state public.enrolment_state not null default 'created',
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- â"€â"€ secrets + release â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.totp_secrets (
  device_id uuid primary key references public.devices(id) on delete cascade,
  secret_enc text not null,             -- encrypted at rest; service-role only
  counter int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.release_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  triggered_by text not null check (triggered_by in ('payment', 'admin', 'dispute')),
  restrictions_cleared boolean not null default false,
  released_at timestamptz not null default now()
);

-- â"€â"€ audit log (secrets banned: never log pin/code/token values) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  retailer_id uuid references public.retailers(id),
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- â"€â"€ actor helpers (read the LIVE profiles row; no auth.users access) â"€â"€â"€â"€â"€â"€â"€â"€â"€
-- HISTORICAL NOTE (2026-10-03): these profile-reading helpers and the
-- policies that use them are REPLACED by the 0005 section below. The final
-- RLS reads role/retailer_id from the JWT app_metadata claim (written by
-- scripts/create_accounts.mjs and the retailer-create route); the live
-- profiles row remains the source for route-level role/suspension checks.
create or replace function public.actor_role() returns text language sql stable as $$
  select coalesce((select role::text from public.profiles where id = auth.uid()), 'none');
$$;

create or replace function public.actor_retailer() returns uuid language sql stable as $$
  select retailer_id from public.profiles where id = auth.uid();
$$;

-- Atomic lock-allowance debit: returns the new balance, or NULL when zero/none.
create or replace function public.decrement_allowance(rid uuid)
returns int language sql volatile as $$
  update public.retailers set lock_allowances = lock_allowances - 1
   where id = rid and lock_allowances > 0
  returning lock_allowances;
$$;

-- â"€â"€ RLS â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
alter table public.profiles enable row level security;
alter table public.retailers enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.customers enable row level security;
alter table public.devices enable row level security;
alter table public.payments enable row level security;
alter table public.emi_schedules enable row level security;
alter table public.device_commands enable row level security;
alter table public.device_command_acks enable row level security;
alter table public.consent_records enable row level security;
alter table public.enrollment_sessions enable row level security;
alter table public.audit_log enable row level security;
alter table public.totp_secrets enable row level security;
alter table public.release_events enable row level security;

-- profiles: self read; owner all.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all
  using (public.actor_role() = 'owner') with check (public.actor_role() = 'owner');

-- retailers: owner all; staff read own.
drop policy if exists retailers_owner on public.retailers;
create policy retailers_owner on public.retailers for all
  using (public.actor_role() = 'owner') with check (public.actor_role() = 'owner');
drop policy if exists retailers_staff_read on public.retailers;
create policy retailers_staff_read on public.retailers for select
  using (public.actor_role() = 'retailer_staff' and id = public.actor_retailer());

-- tenant chain: owner OR (staff of that retailer) OR (customer owning the row).
drop policy if exists ledger_access on public.credit_ledger;
create policy ledger_access on public.credit_ledger for select
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()));

drop policy if exists customers_access on public.customers;
create policy customers_access on public.customers for all
  using (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer())
      or (public.actor_role() = 'customer' and id = auth.uid()))
  with check (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()));

drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select
  using (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer())
      or (public.actor_role() = 'customer' and customer_id = auth.uid()));
drop policy if exists devices_owner_write on public.devices;
create policy devices_owner_write on public.devices for all
  using (public.actor_role() = 'owner')
  with check (public.actor_role() = 'owner');

drop policy if exists payments_access on public.payments;
create policy payments_access on public.payments for all
  using (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff'
          and retailer_id = public.actor_retailer()
          and customer_id in (select id from public.customers where retailer_id = public.actor_retailer())))
  with check (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff'
          and retailer_id = public.actor_retailer()
          and customer_id in (select id from public.customers where retailer_id = public.actor_retailer())));

drop policy if exists schedules_access on public.emi_schedules;
create policy schedules_access on public.emi_schedules for all
  using (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff'
          and retailer_id = public.actor_retailer()
          and customer_id in (select id from public.customers where retailer_id = public.actor_retailer()))
      or (public.actor_role() = 'customer' and customer_id = auth.uid()))
  with check (public.actor_role() = 'owner'
      or (public.actor_role() = 'retailer_staff'
          and retailer_id = public.actor_retailer()
          and customer_id in (select id from public.customers where retailer_id = public.actor_retailer())));

-- device_commands: server-side only for devices (no direct client RLS write).
drop policy if exists commands_read on public.device_commands;
create policy commands_read on public.device_commands for select
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()));

drop policy if exists consent_read on public.consent_records;
create policy consent_read on public.consent_records for select
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and customer_id in
    (select id from public.customers where retailer_id = public.actor_retailer())));

drop policy if exists sessions_access on public.enrollment_sessions;
create policy sessions_access on public.enrollment_sessions for all
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()))
  with check (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and retailer_id = public.actor_retailer()));

-- totp_secrets: service-role only; block all direct access.
drop policy if exists totp_block on public.totp_secrets;
create policy totp_block on public.totp_secrets for select using (false);
drop policy if exists totp_block_w on public.totp_secrets;
create policy totp_block_w on public.totp_secrets for all using (false) with check (false);

drop policy if exists releases_read on public.release_events;
create policy releases_read on public.release_events for select
  using (public.actor_role() = 'owner' or (public.actor_role() = 'retailer_staff' and customer_id in
    (select id from public.customers where retailer_id = public.actor_retailer())));

commit;

-- emidost 0002 â€" performance indexes for hot query paths.
-- On a populated DB run each statement individually (CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction). For this fresh project plain statements
-- are fine. IF NOT EXISTS checks names only; adjust if equivalents exist.

-- Heartbeat hot path: mark-RECEIVED update + pending select (every 6-30 s/device).
create index if not exists device_commands_device_status_created_idx
  on public.device_commands (device_id, status, created_at);

-- Heartbeat next-due + payment settle loop.
create index if not exists emi_schedules_customer_due_idx
  on public.emi_schedules (customer_id, due_date);

-- Enrolment token lookup (register route); unique hardens one-time use.
create unique index if not exists enrollment_sessions_token_hash_uidx
  on public.enrollment_sessions (token_hash);

-- Customers list + duplicate-IMEI check (unique closes the check-then-insert race).
create index if not exists customers_retailer_created_idx
  on public.customers (retailer_id, created_at);
create unique index if not exists customers_retailer_imei_uidx
  on public.customers (retailer_id, imei);

-- Device listings (retailer scoped + owner global).
create index if not exists devices_retailer_created_idx
  on public.devices (retailer_id, created_at);
create index if not exists devices_created_idx
  on public.devices (created_at desc);

-- Audit feeds.
create index if not exists audit_log_created_idx
  on public.audit_log (created_at desc);
create index if not exists audit_log_retailer_created_idx
  on public.audit_log (retailer_id, created_at desc);

-- Ledger + histories.
create index if not exists credit_ledger_retailer_created_idx
  on public.credit_ledger (retailer_id, created_at desc);
create index if not exists payments_customer_created_idx
  on public.payments (customer_id, created_at desc);
create index if not exists device_command_acks_command_received_idx
  on public.device_command_acks (command_id, received_at desc);

-- Consent precondition lookup (newest consent per customer).
create index if not exists consent_records_customer_recorded_idx
  on public.consent_records (customer_id, recorded_at desc);

-- emidost 0003 â€" security + consistency hardening (audit wave, Claude + Codex).
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

-- emidost 0004 - on-demand location + fewer network assumptions.
-- Location is stored only when the device fetches a LOCATION request.

do $$ begin
  alter table public.devices add column if not exists last_location jsonb;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.devices add column if not exists last_location_at timestamptz;
exception when duplicate_column then null; end $$;

-- ADD VALUE cannot run inside a PL/pgSQL exception block (subtransaction);
-- IF NOT EXISTS already makes it idempotent, so run it bare.
alter type public.command_type add value if not exists 'LOCATION';

-- emidost 0005 â€” RLS via JWT app_metadata (fixes the max_stack_depth recursion).
-- The old helper functions SELECTed profiles from inside profiles policies.
-- Roles now live in the JWT app_metadata claim, written by the admin API
-- (create_accounts.mjs / retailer-create route), never by a recursive SELECT.
-- ORDER MATTERS: the dependent policies are dropped first, and only then the
-- helper functions (Postgres refuses to drop a function its policies still use).
--
-- 2026-10-03 audit: staff are SELECT-only on customers, devices, payments and
-- emi_schedules — every mutation must go through the Vercel API / RPCs, which
-- enforce the business rules (settlement, releases, allowances). Staff branches
-- also re-check the LIVE profiles row for suspension (own row via
-- profiles_self, no recursion), so a suspended retailer loses direct DB access
-- immediately instead of waiting for JWT expiry. Owner + service paths are
-- unchanged.

-- profiles: self read only; owner read via JWT claim.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- Suspension guard for every staff branch: the subquery reads the caller's own
-- profile row, which profiles_self permits; suspended staff see no rows and
-- may not write.
-- retailers
drop policy if exists retailers_owner on public.retailers;
create policy retailers_owner on public.retailers for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');
drop policy if exists retailers_staff_read on public.retailers;
create policy retailers_staff_read on public.retailers for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
         and id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
         and not exists (select 1 from public.profiles p
             where p.id = auth.uid() and p.is_suspended));

-- ledger
drop policy if exists ledger_access on public.credit_ledger;
create policy ledger_access on public.credit_ledger for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- customers: staff are read-only; only the owner keeps write access (mutations
-- run through the API as the service role).
drop policy if exists customers_access on public.customers;
create policy customers_read on public.customers for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));
create policy customers_owner on public.customers for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- devices
drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));
drop policy if exists devices_owner_write on public.devices;
create policy devices_owner_write on public.devices for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- payments: staff are read-only (no direct UPDATE/DELETE of payment rows).
drop policy if exists payments_access on public.payments;
create policy payments_read on public.payments for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));
create policy payments_owner on public.payments for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- schedules: staff are read-only (settlement runs through record_payment).
drop policy if exists schedules_access on public.emi_schedules;
create policy schedules_read on public.emi_schedules for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));
create policy schedules_owner on public.emi_schedules for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- commands
drop policy if exists commands_read on public.device_commands;
create policy commands_read on public.device_commands for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- consent
drop policy if exists consent_read on public.consent_records;
create policy consent_read on public.consent_records for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and customer_id in (select id from public.customers
              where retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid)
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- sessions
drop policy if exists sessions_access on public.enrollment_sessions;
create policy sessions_access on public.enrollment_sessions for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- audit
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- releases
drop policy if exists releases_read on public.release_events;
create policy releases_read on public.release_events for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and customer_id in (select id from public.customers
              where retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid)
          and not exists (select 1 from public.profiles p
              where p.id = auth.uid() and p.is_suspended)));

-- Only after every dependent policy is recreated may the old recursive
-- helpers go away.
drop function if exists public.actor_role();
drop function if exists public.actor_retailer();


-- emidost 0006 â€” retention (keeps the free 500 MB DB from filling up).
-- Prunes acked commands, their acks, and old audit rows. Uses pg_cron when the
-- extension is available; the plain statements can also be run manually.

-- One-off cleanup (safe to run anytime).
delete from public.device_command_acks
 where received_at < now() - interval '30 days';
delete from public.device_commands
 where status in ('EXECUTED','SUPERSEDED','CANCELLED','FAILED','EXPIRED')
   and created_at < now() - interval '60 days';
delete from public.audit_log
 where created_at < now() - interval '90 days';

-- Scheduled cleanup if pg_cron is enabled (create extension via dashboard if
-- missing; this block is harmless either way). Note the distinct dollar-quote
-- tags: the inner command string must not close the outer DO block.
do $ret$
declare
  has_cron boolean;
begin
  select exists(select 1 from pg_extension where extname = 'pg_cron') into has_cron;
  if has_cron then
    perform cron.schedule(
      'emidost-retention',
      '0 3 * * *',
      $cron$delete from public.device_command_acks where received_at < now() - interval '30 days';
        delete from public.device_commands where status in ('EXECUTED','SUPERSEDED','CANCELLED','FAILED','EXPIRED') and created_at < now() - interval '60 days';
        delete from public.audit_log where created_at < now() - interval '90 days';$cron$
    );
  end if;
end $ret$;

-- emidost 0007 - per-customer lock mode + offline watchdog support.
-- lock_mode 'lock' (default): the phone locks on overdue and after 5 days
-- without internet. 'notify_only': never locks; only reminders and overdue
-- notices. The device caches this value from the heartbeat response.

do $$ begin
  alter table public.customers add column if not exists lock_mode text not null default 'lock'
    check (lock_mode in ('lock', 'notify_only'));
exception when duplicate_object then null; end $$;

create index if not exists customers_lock_mode_idx
  on public.customers (lock_mode);

-- emidost 0008 - allowance refunds + credit lifecycle support.
-- Called only from verified terminal acks / release transitions.

create or replace function public.increment_allowance(rid uuid)
returns int language sql volatile as $$
  update public.retailers set lock_allowances = lock_allowances + 1
   where id = rid
  returning lock_allowances;
$$;

-- One-time credit lifecycle: ACTIVE activation consumes a slot once
-- (guarded by the enrolment-state CAS in the heartbeat), RELEASE refunds
-- once (guarded by the unique release_events row).
create or replace function public.consume_device_credit(rid uuid)
returns int language sql volatile as $$
  update public.retailers set credits_balance = credits_balance - 1
   where id = rid and credits_balance > 0
  returning credits_balance;
$$;

create or replace function public.refund_device_credit(rid uuid)
returns int language sql volatile as $$
  update public.retailers set credits_balance = credits_balance + 1
   where id = rid
  returning credits_balance;
$$;

-- emidost 0009 - shared rate limiting (free, uses the existing Supabase DB).
-- Works across all serverless instances (Worker + Vercel). The 0011 section
-- below enables RLS on this table and revokes public execute on
-- rate_limit_hit, closing it to non-service roles.

create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 0,
  reset_at timestamptz not null default now()
);

create or replace function public.rate_limit_hit(k text, lim int, win_ms int)
returns boolean
language sql volatile security definer set search_path = public as $$
  with now_ts as (select clock_timestamp() as t),
  ups as (
    insert into public.rate_limits (key, count, reset_at)
    select k, 1, (select t from now_ts) + (win_ms * interval '1 millisecond')
    on conflict (key) do update set
      count = case
        when public.rate_limits.reset_at <= (select t from now_ts) then 1
        else public.rate_limits.count + 1 end,
      reset_at = case
        when public.rate_limits.reset_at <= (select t from now_ts)
          then (select t from now_ts) + (win_ms * interval '1 millisecond')
        else public.rate_limits.reset_at end
    returning count
  )
  select count <= lim from ups;
$$;

-- emidost 0010 - credit lifecycle fixes (audit 2026-10-02).
-- Idempotent. Apply after 0009 (or use 0000_all_in_one.sql which includes this).

-- 1. Allowance refunds get their own ledger kind (ack.ts used 'slot_refund',
--    which the enum rejected, so refund rows were silently dropped).
alter type public.ledger_kind add value if not exists 'lock_refund';

-- 2. A device frees its credit at most once, and only if activation consumed
--    one. The partial unique index makes a concurrent second release fail.
create unique index if not exists credit_ledger_slot_freed_device_uidx
  on public.credit_ledger (device_id) where kind = 'slot_freed';

create or replace function public.release_device_credit(rid uuid, did uuid)
returns int language plpgsql volatile as $$
declare bal int;
begin
  if not exists (
    select 1 from public.credit_ledger where device_id = did and kind = 'slot_consumed'
  ) then
    return null;
  end if;
  if exists (
    select 1 from public.credit_ledger where device_id = did and kind = 'slot_freed'
  ) then
    return null;
  end if;
  update public.retailers set credits_balance = credits_balance + 1
   where id = rid
  returning credits_balance into bal;
  if bal is null then
    return null;
  end if;
  insert into public.credit_ledger (retailer_id, kind, delta, balance_after, device_id)
  values (rid, 'slot_freed', 1, bal, did);
  return bal;
end $$;

-- 3. Atomic payment allocation: the payment row and the oldest-first schedule
--    settlement commit together, and concurrent payments for one customer
--    serialize on the customer row (no double allocation). Overpayments are
--    REJECTED (exception 'overpayment'); partials are fine. Returns the
--    payment id and whether the loan is now complete.
create or replace function public.record_payment(
  cid uuid, amt numeric, pay_method text, receipt text, recorder uuid
) returns table (payment_id uuid, completed boolean)
language plpgsql volatile as $$
declare
  cust record;
  sched record;
  remaining numeric := amt;
  need numeric;
  need_total numeric;
  pid uuid;
begin
  select id, retailer_id, status into cust
    from public.customers where id = cid for update;
  if cust.id is null then
    raise exception 'customer not found';
  end if;
  if cust.status in ('COMPLETE', 'SETTLED') then
    raise exception 'loan settled';
  end if;

  -- Overpayment guard (under the customer lock): anything above the total
  -- remaining due would be silently swallowed by the allocation loop.
  select coalesce(sum(amount_due - coalesce(amount_paid, 0)), 0) into need_total
    from public.emi_schedules
   where customer_id = cid and status in ('PENDING', 'OVERDUE', 'PARTIAL');
  if amt > need_total then
    raise exception 'overpayment: at most % is due', need_total;
  end if;

  insert into public.payments (customer_id, retailer_id, amount, method, receipt_no, recorded_by)
  values (cid, cust.retailer_id, amt, coalesce(pay_method, 'cash'), receipt, recorder)
  returning id into pid;

  for sched in
    select id, amount_due, amount_paid from public.emi_schedules
     where customer_id = cid and status in ('PENDING', 'OVERDUE', 'PARTIAL')
     order by due_date
  loop
    exit when remaining <= 0;
    need := sched.amount_due - coalesce(sched.amount_paid, 0);
    continue when need <= 0;
    if remaining >= need then
      update public.emi_schedules set status = 'PAID', amount_paid = sched.amount_due where id = sched.id;
      remaining := remaining - need;
    else
      update public.emi_schedules
         set status = 'PARTIAL', amount_paid = coalesce(sched.amount_paid, 0) + remaining
       where id = sched.id;
      remaining := 0;
    end if;
  end loop;

  if not exists (
    select 1 from public.emi_schedules
     where customer_id = cid and status in ('PENDING', 'PARTIAL', 'OVERDUE')
  ) then
    update public.customers set status = 'COMPLETE' where id = cid;
    insert into public.release_events (customer_id, triggered_by) values (cid, 'payment');
    payment_id := pid; completed := true;
  else
    payment_id := pid; completed := false;
  end if;
  return next;
end $$;

-- 4. Rate-limit rows expire with their window; prune them so the table does
--    not grow by one row per IP/installation forever.
create index if not exists rate_limits_reset_idx on public.rate_limits (reset_at);
delete from public.rate_limits where reset_at < now() - interval '1 day';
do $rl$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'emidost-rate-limit-prune',
      '15 * * * *',
      $cron$delete from public.rate_limits where reset_at < now() - interval '1 hour';$cron$
    );
  end if;
end $rl$;

-- emidost 0011 - close the rate_limits table (audit 2026-10-03).
-- 0009 created the table with RLS DISABLED; Supabase's default grants give
-- anon/authenticated table privileges on the public schema, so the table was
-- readable and writable by anyone holding the public anon key (keys leak IP +
-- installation pairs; rows could be deleted to bypass the limiter).
-- With RLS enabled and no permissive policies, only the service role and the
-- SECURITY DEFINER rate_limit_hit function can touch it.
-- Idempotent: safe to re-run.

alter table public.rate_limits enable row level security;

-- Revoke direct execution from everyone; the web API calls rate_limit_hit
-- with the service-role key (serviceClient), which keeps working.
revoke all on function public.rate_limit_hit(text, int, int) from public;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- emidost 0012 - REBOOT command type (owner-only recovery affordance).
-- The device refuses REBOOT while locked (native rebootDevice guard, D4);
-- the owner board queues it for unlocked/stuck phones. Retailer routes never
-- accept REBOOT, so it cannot consume lock allowances or bypass the DO gate.
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run.

alter type public.command_type add value if not exists 'REBOOT';

-- emidost 0013 - FCM/Expo push wake-up tokens (layered fallback: push -> poll -> SMS).
-- The token is a WAKE-ONLY kick: the push payload carries no command content,
-- the phone always fetches the real command via its authenticated heartbeat,
-- so Supabase stays the single source of truth and a forged push can at most
-- trigger one poll. Token hygiene: the column is revoked from anon and
-- authenticated (service role keeps access; staff SELECT policies stay
-- table-level, so this revoke closes the column for them too).
-- Idempotent: safe to re-run.

do $$ begin
  alter table public.devices add column if not exists fcm_token text;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.devices add column if not exists fcm_token_updated_at timestamptz;
exception when duplicate_column then null; end $$;

revoke select (fcm_token, fcm_token_updated_at) on public.devices from anon, authenticated;

-- emidost 0014 - customer photos (private storage bucket + customers.photo_path).
-- Photos live in a PRIVATE Supabase Storage bucket; uploads go through the API
-- route with the service role (no bucket policies = no public or anon access).
-- The heartbeat mints a signed URL for the bound device; the phone caches the
-- file for offline use. The retailer app shows its own local preview and never
-- needs a signed URL at upload time.
-- Idempotent: safe to re-run.

do $$ begin
  alter table public.customers add column if not exists photo_path text;
exception when duplicate_column then null; end $$;

insert into storage.buckets (id, name, public)
values ('customer-photos', 'customer-photos', false)
on conflict (id) do nothing;

-- Deliberately NO storage.objects policies: the bucket is service-role only.

-- emidost 0015 - overdue escalation (kill-switch column + ALERT command type).
-- overdue_escalation_enabled (default true) is the portal/console kill-switch:
-- false stops the 30-min voice escalation AND the day-3+ location SMS on the
-- phone (delivered via heartbeat; audited). ALERT is the retailer's one-shot
-- bn+hi voice command: it consumes NO lock allowance and is refused on
-- settled loans exactly like LOCK.
-- Idempotent: safe to re-run.

do $$ begin
  alter table public.customers add column if not exists overdue_escalation_enabled boolean not null default true;
exception when duplicate_column then null; end $$;

alter type public.command_type add value if not exists 'ALERT';

-- emidost 0016 - REMIND command type (reminder control shift).
-- Automatic pre-due AND post-due scheduled reminders (−3/−1/+1/+3) are
-- removed: the due-day 3x and the overdue escalation stay automatic, and
-- everything before the due day is RETAILER-TRIGGERED — the online REMIND
-- command (friendly bn/hi payment-reminder voice + notification) or the
-- offline SMS REMIND <code>. REMIND consumes NO allowance and is refused on
-- settled loans, exactly like ALERT. Retailer-triggered REMIND/ALERT/LOCATION
-- work even when the escalation kill-switch is off (a deliberate retailer
-- action beats the anti-harassment toggle; automatic escalation still
-- respects it).
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run.

alter type public.command_type add value if not exists 'REMIND';
