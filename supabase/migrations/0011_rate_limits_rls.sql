-- emidost 0011 - close the rate_limits table (audit 2026-10-03).
-- 0009 created the table with RLS DISABLED; Supabase's default grants give
-- anon/authenticated table privileges on the public schema, so the table was
-- readable and writable by anyone holding the public anon key (keys leak IP +
-- installation pairs; rows could be deleted to bypass the limiter).
-- With RLS enabled and no permissive policies, only the service role and the
-- SECURITY DEFINER rate_limit_hit function can touch it.
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

alter table public.rate_limits enable row level security;

-- Revoke direct execution from everyone; the web API calls rate_limit_hit
-- with the service-role key (serviceClient), which keeps working.
revoke all on function public.rate_limit_hit(text, int, int) from public;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;
