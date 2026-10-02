-- emidost 0009 - shared rate limiting (free, uses the existing Supabase DB).
-- Works across all serverless instances (Worker + Vercel). 0011 enables RLS
-- on this table and revokes public execute on rate_limit_hit, closing it to
-- non-service roles (apply 0011 after this; 0000_all_in_one.sql includes it).

create table if not exists public.rate_limits (
  key text primary key,
  count int not null default 0,
  reset_at timestamptz not null default now()
);

create or replace function public.rate_limit_hit(k text, lim int, win_ms int)
returns boolean
language sql volatile security definer set search_path = public as $$
  with now_ts as (select clock_timestamp() as t),
  ups as (
    insert into public.rate_limits (key, count, reset_at)
    select k, 1, (select t from now_ts) + (win_ms * interval '1 millisecond')
    on conflict (key) do update set
      count = case
        when public.rate_limits.reset_at <= (select t from now_ts) then 1
        else public.rate_limits.count + 1 end,
      reset_at = case
        when public.rate_limits.reset_at <= (select t from now_ts)
          then (select t from now_ts) + (win_ms * interval '1 millisecond')
        else public.rate_limits.reset_at end
    returning count
  )
  select count <= lim from ups;
$$;
