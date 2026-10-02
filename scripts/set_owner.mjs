// Owner (admin) account provisioner — idempotent.
//
//   node scripts/set_owner.mjs                          # ensure dip@emidost.in exists with role=owner
//   node scripts/set_owner.mjs --password "YourPass123" # ...and set/replace the password
//   node scripts/set_owner.mjs --email other@x.in --password "YourPass123"
//
// Behaviour:
//   - If the target email already exists: merges the owner claim + profile role,
//     and updates the password only when --password / OWNER_PASSWORD is given.
//   - Else if another owner account exists (legacy owner@emidost.in): RENAMES it
//     to the target email so the profile id and every retailer.owner_id link
//     survive, then applies claims/profile/password.
//   - Else: creates a fresh confirmed user + owner profile.
//
// The password is never printed and never stored in the repo.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envText = readFileSync(resolve(root, 'web/.env.local'), 'utf8').replace(/^\uFEFF/, '');
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter(Boolean).filter((l) => !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; }),
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in web/.env.local');
  process.exit(1);
}

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const EMAIL = arg('email') ?? process.env.OWNER_EMAIL ?? 'dip@emidost.in';
const PASSWORD = arg('password') ?? process.env.OWNER_PASSWORD ?? null;
const LEGACY = 'owner@emidost.in';
if (PASSWORD !== null && PASSWORD.length < 8) {
  console.error('Password must be at least 8 characters (Supabase default policy).');
  process.exit(1);
}

const admin = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body).slice(0, 240)}`);
  return body;
};

const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(body).slice(0, 240)}`);
  return body;
};

const listUsers = async () => (await admin('/users?per_page=200')).users ?? [];

async function ensureProfile(userId, name) {
  const rows = await rest('profiles', {
    method: 'POST',
    body: JSON.stringify([{ id: userId, role: 'owner', full_name: name, is_suspended: false }]),
  });
  return rows?.[0]?.id ?? userId;
}

async function main() {
  const users = await listUsers();
  const target = users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
  const ownerProfile = await rest('profiles?select=id,full_name&role=eq.owner');
  const legacyPhone = ownerProfile?.[0]?.full_name ? 'Owner' : 'Owner';

  let userId;
  let action;

  if (target) {
    userId = target.id;
    action = 'existing account updated';
    await admin(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({
        app_metadata: { ...(target.app_metadata ?? {}), role: 'owner', provider: 'email', providers: ['email'] },
        ...(PASSWORD ? { password: PASSWORD } : {}),
      }),
    });
  } else {
    const legacy = users.find((u) => u.email?.toLowerCase() === LEGACY);
    if (legacy) {
      userId = legacy.id;
      action = `renamed ${LEGACY} -> ${EMAIL} (profile id and owner_id links preserved)`;
      await admin(`/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({
          email: EMAIL,
          email_confirm: true,
          app_metadata: { ...(legacy.app_metadata ?? {}), role: 'owner', provider: 'email', providers: ['email'] },
          ...(PASSWORD ? { password: PASSWORD } : {}),
        }),
      });
    } else {
      action = 'new owner account created';
      const created = await admin('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: EMAIL,
          ...(PASSWORD ? { password: PASSWORD } : {}),
          email_confirm: true,
          app_metadata: { role: 'owner', provider: 'email', providers: ['email'] },
          user_metadata: { name: 'Owner' },
        }),
      });
      userId = created.id;
    }
  }

  await ensureProfile(userId, legacyPhone);
  const check = (await listUsers()).find((u) => u.id === userId);
  console.log(`owner login : ${check?.email}`);
  console.log(`user id     : ${userId}`);
  console.log(`role claim  : ${check?.app_metadata?.role}`);
  console.log(`password    : ${PASSWORD ? 'set (not printed)' : 'unchanged'}`);
  if (!PASSWORD) {
    console.log(`\nTo choose the password now:  node scripts/set_owner.mjs --password "YourPassword"`);
  }
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
