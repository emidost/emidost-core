-- emidost 0005 — RLS via JWT app_metadata (fixes the max_stack_depth recursion).
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
-- unchanged. The apiKey-role branch: none (devices never get a PostgREST JWT).

-- 0. POLICY RESET (2026-10-03): a partially migrated database can still carry
-- a legacy recursive policy (for example the original `*_access` policies that
-- called actor_role(), or an older profiles policy). Postgres ORs permissive
-- policies together, so ONE surviving recursive policy keeps breaking every
-- authenticated read with "stack depth limit exceeded" no matter how correct
-- the new ones are. Drop every policy on the public tables first, then create
-- exactly the set below. Idempotent and safe to re-run.
do $$
declare r record;
begin
  for r in select policyname, schemaname, tablename from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

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
