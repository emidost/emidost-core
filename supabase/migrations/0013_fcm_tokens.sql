-- emidost 0013 - FCM/Expo push wake-up tokens (layered fallback: push -> poll -> SMS).
-- The token is a WAKE-ONLY kick: the push payload carries no command content,
-- the phone always fetches the real command via its authenticated heartbeat,
-- so Supabase stays the single source of truth and a forged push can at most
-- trigger one poll. Token hygiene: the column is revoked from anon and
-- authenticated (service role keeps access; staff SELECT policies stay
-- table-level, so this revoke closes the column for them too).
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

do $$ begin
  alter table public.devices add column if not exists fcm_token text;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.devices add column if not exists fcm_token_updated_at timestamptz;
exception when duplicate_column then null; end $$;

revoke select (fcm_token, fcm_token_updated_at) on public.devices from anon, authenticated;
