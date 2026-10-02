-- emidost 0004 - on-demand location + fewer network assumptions.
-- Location is stored only when the device fetches a LOCATION request.

do $$ begin
  alter table public.devices add column if not exists last_location jsonb;
exception when duplicate_column then null; end $$;

do $$ begin
  alter table public.devices add column if not exists last_location_at timestamptz;
exception when duplicate_column then null; end $$;

-- ADD VALUE cannot run inside a PL/pgSQL exception block (subtransaction);
-- IF NOT EXISTS already makes it idempotent, so run it bare.
alter type public.command_type add value if not exists 'LOCATION';
