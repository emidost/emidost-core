-- emidost 0018 - owner-set app config (customer APK download URL + signing SHA-256)
-- The owner sets these once; the retailer app reads them to build the enrolment
-- QR (device-owner provisioning QR for the kiosk path, and a download+bind QR
-- for the wireless path), so staff never type the APK link or the customer code.
-- All access goes through the API with the service role (role-gated in the
-- handler, same pattern as every other table here); direct anon/authenticated
-- access is revoked. Idempotent: safe to re-run (also folded into
-- 0000_all_in_one.sql).

create table if not exists public.app_config (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;
