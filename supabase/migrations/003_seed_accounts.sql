-- emidost 003 — seed accounts (owner, sample retailer, sample customer).
-- Run AFTER 0001 + 0002. Change emails and passwords before running.
-- Passwords are bcrypt-hashed via crypt(); plaintext never stored.
-- Roles are read live from public.profiles by RLS (no auth.users metadata).

-- 1. OWNER
insert into auth.users
  (id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin)
values
  (gen_random_uuid(), 'authenticated', 'authenticated',
   'owner@emidost.in', crypt('Owner@Pass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"name":"Owner"}', now(), now(), false);

insert into public.profiles (id, role, full_name, phone, is_suspended)
select id, 'owner', 'Owner', '917003617074', false
from auth.users where email = 'owner@emidost.in'
on conflict (id) do nothing;

-- 2. SAMPLE RETAILER (one auth user + retailer row + staff profile)
with r as (
  insert into public.retailers (owner_id, name, phone, credits_balance, lock_allowances)
  select p.id, 'Demo Phone House', '919800000001', 10, 50
  from public.profiles p where p.role = 'owner'
  returning id
), u as (
  insert into auth.users
    (id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin)
  values
    (gen_random_uuid(), 'authenticated', 'authenticated',
     'retailer@emidost.in', crypt('Retailer@Pass123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"name":"Demo Retailer"}', now(), now(), false)
  returning id
)
insert into public.profiles (id, role, retailer_id, full_name, phone, is_suspended)
select u.id, 'retailer_staff', r.id, 'Demo Retailer', '919800000001', false
from r, u;

-- 3. SAMPLE CUSTOMER (auth user + profile + customer row under the retailer)
with r as (
  select id from public.retailers where name = 'Demo Phone House' limit 1
), u as (
  insert into auth.users
    (id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin)
  values
    (gen_random_uuid(), 'authenticated', 'authenticated',
     'customer@emidost.in', crypt('Customer@Pass123', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"name":"Demo Customer"}', now(), now(), false)
  returning id
), p as (
  insert into public.profiles (id, role, full_name, phone, is_suspended)
  select u.id, 'customer', 'Demo Customer', '919800000002', false from u
  returning id
), c as (
  insert into public.customers (retailer_id, name, phone, imei, brand, model,
    emi_months, emi_amount, emi_due_day, customer_code, status)
  select r.id, 'Demo Customer', '919800000002', '000000000000000', 'Samsung', 'Galaxy A15',
    12, 2400, 5, 'EMD-DEMO', 'RUNNING'
  from r
  returning id
)
insert into public.emi_schedules (customer_id, retailer_id, due_date, amount_due, status)
select c.id, r.id, (date_trunc('month', now()) + interval '1 month' + interval '4 days')::date, 2400, 'PENDING'
from c, r;

-- Verify (expect 3 profiles, 1 retailer, 1 customer):
-- select p.email, p.role, pr.full_name from auth.users u join public.profiles p on p.id = u.id;
