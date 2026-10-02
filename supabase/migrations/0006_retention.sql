-- emidost 0006 — retention (keeps the free 500 MB DB from filling up).
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
