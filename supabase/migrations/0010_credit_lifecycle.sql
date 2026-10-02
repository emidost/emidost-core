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
--    serialize on the customer row (no double allocation). Returns the
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
