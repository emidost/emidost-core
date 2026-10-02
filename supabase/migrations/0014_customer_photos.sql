-- emidost 0014 - customer photos (private storage bucket + customers.photo_path).
-- Photos live in a PRIVATE Supabase Storage bucket; uploads go through the API
-- route with the service role (no bucket policies = no public or anon access).
-- The heartbeat mints a signed URL for the bound device; the phone caches the
-- file for offline use. The retailer app shows its own local preview and never
-- needs a signed URL at upload time.
-- Idempotent: safe to re-run (or use 0000_all_in_one.sql which includes this).

do $$ begin
  alter table public.customers add column if not exists photo_path text;
exception when duplicate_column then null; end $$;

insert into storage.buckets (id, name, public)
values ('customer-photos', 'customer-photos', false)
on conflict (id) do nothing;

-- Deliberately NO storage.objects policies: the bucket is service-role only.
