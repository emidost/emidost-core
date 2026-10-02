-- emidost 0015 - overdue escalation (kill-switch column + ALERT command type).
-- overdue_escalation_enabled (default true) is the portal/console kill-switch:
-- false stops the 30-min voice escalation AND the day-3+ location SMS on the
-- phone (delivered via heartbeat; audited). ALERT is the retailer's one-shot
-- bn+hi voice command: it consumes NO lock allowance and is refused on
-- settled loans exactly like LOCK.
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

do $$ begin
  alter table public.customers add column if not exists overdue_escalation_enabled boolean not null default true;
exception when duplicate_column then null; end $$;

alter type public.command_type add value if not exists 'ALERT';
