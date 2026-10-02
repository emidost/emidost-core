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
