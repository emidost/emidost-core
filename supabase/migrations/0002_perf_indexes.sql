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
