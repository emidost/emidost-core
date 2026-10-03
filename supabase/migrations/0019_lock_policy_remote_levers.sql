-- emidost 0019 - retailer-controlled lock policy + remote-lever command types.
-- Lock policy: locking is retailer-controlled. `customers.auto_lock_on_overdue`
-- (default false = manual-lock only; the phone stays always-on and listening
-- but never auto-locks) is set true only when the retailer records an EMI plan
-- for the customer; then the overdue auto-lock engages. The EMI columns become
-- nullable so a retailer can create a "no EMI record" customer (manual-only,
-- fully silent). Three new command types (owner + retailer; online + SMS):
--   SET_DEVICE_PIN  - set the exact lock-screen PIN (payload.pin)
--   SET_WALLPAPER   - set a reminder wallpaper or clear it (payload.mode)
--   GET_SIM         - the phone reports its SIM info on the next heartbeat
-- devices.sim_info caches the reported SIM info; it may carry IMSI/ICCID, so
-- SELECT on it is revoked from anon/authenticated (service role keeps access),
-- the same hygiene as fcm_token (0013).
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

alter type public.command_type add value if not exists 'SET_DEVICE_PIN';
alter type public.command_type add value if not exists 'SET_WALLPAPER';
alter type public.command_type add value if not exists 'GET_SIM';

alter table public.customers
  add column if not exists auto_lock_on_overdue boolean not null default false;

-- No-EMI-record customers: the EMI plan is optional (manual-lock only).
alter table public.customers alter column emi_months drop not null;
alter table public.customers alter column emi_amount drop not null;
alter table public.customers alter column emi_due_day drop not null;

alter table public.devices add column if not exists sim_info jsonb;
revoke select (sim_info) on public.devices from anon, authenticated;
