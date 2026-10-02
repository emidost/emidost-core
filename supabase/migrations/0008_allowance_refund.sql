-- emidost 0008 - allowance refunds + credit lifecycle support.
-- Called only from verified terminal acks / release transitions.

create or replace function public.increment_allowance(rid uuid)
returns int language sql volatile as $$
  update public.retailers set lock_allowances = lock_allowances + 1
   where id = rid
  returning lock_allowances;
$$;

-- One-time credit lifecycle: ACTIVE activation consumes a slot once
-- (guarded by the enrolment-state CAS in the heartbeat), RELEASE refunds
-- once (guarded by the unique release_events row).
create or replace function public.consume_device_credit(rid uuid)
returns int language sql volatile as $$
  update public.retailers set credits_balance = credits_balance - 1
   where id = rid and credits_balance > 0
  returning credits_balance;
$$;

create or replace function public.refund_device_credit(rid uuid)
returns int language sql volatile as $$
  update public.retailers set credits_balance = credits_balance + 1
   where id = rid
  returning credits_balance;
$$;
