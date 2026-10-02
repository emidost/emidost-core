// emidost account creator â€” replaces the SQL seed (the SQL editor cannot
// write auth.users). Run AFTER the schema SQL succeeded:
//   node scripts/create_accounts.mjs
// Reads the keys from web/.env.local. Creates owner, retailer, and customer
// auth users via the admin API, then inserts profile/retailer/customer rows
// via PostgREST with the service role.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(resolve(root, 'web/.env.local'), 'utf8').replace(/^\uFEFF/, '');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SERVICE_ROLE_KEY');
  process.exit(1);
}

const ACCOUNTS = [
  { email: 'owner@emidost.in', password: 'Owner@Pass123', role: 'owner', name: 'Owner', phone: '917003617074', retailer: null },
  { email: 'retailer@emidost.in', password: 'Retailer@Pass123', role: 'retailer_staff', name: 'Demo Retailer', phone: '919800000001', retailer: 'Demo Phone House' },
  { email: 'customer@emidost.in', password: 'Customer@Pass123', role: 'customer', name: 'Demo Customer', phone: '919800000002', retailer: null },
];

async function admin(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body)}`);
  return body;
}

async function rest(table, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${table}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  // 1. Owner
  const ownerUser = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      email: ACCOUNTS[0].email, password: ACCOUNTS[0].password, email_confirm: true,
      app_metadata: { role: 'owner', provider: 'email', providers: ['email'] },
      user_metadata: { name: ACCOUNTS[0].name },
    }),
  });
  const ownerProfile = await rest('profiles', 'POST', {
    id: ownerUser.id, role: 'owner', full_name: ACCOUNTS[0].name, phone: ACCOUNTS[0].phone, is_suspended: false,
  });
  console.log('owner:', ownerUser.email, ownerProfile[0].id);

  // 2. Retailer row (owner_id = owner profile)
  const retailerRow = await rest('retailers', 'POST', {
    owner_id: ownerUser.id, name: 'Demo Phone House', phone: '919800000001',
    credits_balance: 10, lock_allowances: 50,
  });
  const retailerId = retailerRow[0].id;
  const staffUser = await admin('/users', {
    method: 'POST',
    body: JSON.stringify({
      email: ACCOUNTS[1].email, password: ACCOUNTS[1].password, email_confirm: true,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { name: ACCOUNTS[1].name },
    }),
  });
  await rest('profiles', 'POST', {
    id: staffUser.id, role: 'retailer_staff', retailer_id: retailerId,
    full_name: ACCOUNTS[1].name, phone: ACCOUNTS[1].phone, is_suspended: false,
  });
  // RLS (0005) reads role/retailer_id from the JWT app_metadata claim; the
  // provider/providers keys are kept so GoTrue account linking still works
  // (merge, never a bare replace).
  await admin(`/users/${staffUser.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      app_metadata: {
        role: 'retailer_staff', retailer_id: retailerId,
        provider: 'email', providers: ['email'],
      },
    }),
  });
  console.log('retailer:', staffUser.email, retailerId);

  // 3. Customer: NO auth account. Customers are created by the retailer in the
  // retailer app (customers row + setup code); the customer app binds with the
  // setup code + a device token. Only a demo row is created here so the board
  // is not empty.
  const custRow = await rest('customers', 'POST', {
    retailer_id: retailerId, name: 'Demo Customer', phone: '919800000002',
    imei: '000000000000000', brand: 'Samsung', model: 'Galaxy A15',
    emi_months: 12, emi_amount: 2400, emi_due_day: 5, customer_code: 'EMD-DEMO', status: 'RUNNING',
  });
  const due = new Date();
  due.setMonth(due.getMonth() + 1);
  due.setDate(5);
  await rest('emi_schedules', 'POST', {
    customer_id: custRow[0].id, retailer_id: retailerId,
    due_date: due.toISOString().slice(0, 10), amount_due: 2400, status: 'PENDING',
  });
  console.log('customer (no login; binds via setup code):', custRow[0].id);
  console.log('done: 2 accounts (owner, retailer) + 1 retailer + 1 demo customer + 1 EMI schedule');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
