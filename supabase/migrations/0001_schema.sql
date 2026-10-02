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
-- Newer Supabase auth schemas have no app_metadata column on auth.users, so
-- RLS resolves the role straight from public.profiles on every request. This
-- also makes suspension and role changes apply instantly, never via a stale JWT.
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
