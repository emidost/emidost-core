-- emidost 0005 — RLS via JWT app_metadata (fixes the max_stack_depth recursion).
-- The old helper functions SELECTed profiles from inside profiles policies.
-- Roles now live in the JWT app_metadata claim, written by the admin API
-- (create_accounts.mjs / retailer-create route), never by a recursive SELECT.
-- ORDER MATTERS: the dependent policies are dropped first, and only then the
-- helper functions (Postgres refuses to drop a function its policies still use).

-- profiles: self read only; owner read via JWT claim.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (id = auth.uid());
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- retailers
drop policy if exists retailers_owner on public.retailers;
create policy retailers_owner on public.retailers for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');
drop policy if exists retailers_staff_read on public.retailers;
create policy retailers_staff_read on public.retailers for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
         and id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid);

-- ledger
drop policy if exists ledger_access on public.credit_ledger;
create policy ledger_access on public.credit_ledger for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- customers
drop policy if exists customers_access on public.customers;
create policy customers_access on public.customers for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- devices
drop policy if exists devices_access on public.devices;
create policy devices_access on public.devices for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));
drop policy if exists devices_owner_write on public.devices;
create policy devices_owner_write on public.devices for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner')
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner');

-- payments
drop policy if exists payments_access on public.payments;
create policy payments_access on public.payments for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- schedules
drop policy if exists schedules_access on public.emi_schedules;
create policy schedules_access on public.emi_schedules for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- commands
drop policy if exists commands_read on public.device_commands;
create policy commands_read on public.device_commands for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- consent
drop policy if exists consent_read on public.consent_records;
create policy consent_read on public.consent_records for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and customer_id in (select id from public.customers
              where retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid)));

-- sessions
drop policy if exists sessions_access on public.enrollment_sessions;
create policy sessions_access on public.enrollment_sessions for all
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid))
  with check (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- audit
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid));

-- releases
drop policy if exists releases_read on public.release_events;
create policy releases_read on public.release_events for select
  using (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'owner'
      or (coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'none') = 'retailer_staff'
          and customer_id in (select id from public.customers
              where retailer_id = (auth.jwt() -> 'app_metadata' ->> 'retailer_id')::uuid)));

-- Only after every dependent policy is recreated may the old recursive
-- helpers go away.
drop function if exists public.actor_role();
drop function if exists public.actor_retailer();

