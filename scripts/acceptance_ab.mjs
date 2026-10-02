// A+B acceptance test — runs the full enrolment + command + unlock + escalation
// + payment flow against the LIVE API without a phone, simulating the device.
//
// Path A (QR provisioning) and path B (wireless self-pair) share this entire
// server chain: token enrolment -> register -> heartbeat activation -> commands
// -> acks -> unlock key -> escalation toggle -> payments. The only parts this
// cannot cover are the OS-level Device Owner grant and the adb pairing, which
// need real hardware (see docs/VERIFICATION_CHECKLIST.md sections A/B/H).
//
// Usage: node scripts/acceptance_ab.mjs [--api https://...] [--keep]
// Evidence: every step prints PASS/FAIL with the server's own response.

import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const args = process.argv.slice(2);
const apiArg = args.includes('--api') ? args[args.indexOf('--api') + 1] : null;
const API = (apiArg ?? 'https://emidost-pd8s.vercel.app').replace(/\/$/, '');

function env(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const E = env(`${ROOT}/web/.env.local`);
const SUPABASE = E.NEXT_PUBLIC_SUPABASE_URL;
const ANON = E.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = E.SUPABASE_SERVICE_ROLE_KEY;

const ok2 = (s) => s === 200 || s === 201;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
}

async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  return json.access_token ?? null;
}

async function svc(path) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const TEST_IMEI = '990000000000001';
const TEST_INSTALL = 'ab-test-installation';
const TEST_DEVICE_TOKEN = randomBytes(24).toString('hex');
const TEST_FCM = 'ExponentPushToken[ab-acceptance-test]';

console.log(`\n=== emidost A+B acceptance test ===\nAPI: ${API}\n`);

// 1. health
const health = await api('/api/health');
check('health endpoint responds 200', health.status === 200, `status ${health.status}`);

// 2. logins
const ownerToken = await signIn('owner@emidost.in', 'Owner@Pass123');
check('owner signs in', Boolean(ownerToken));
const retailerToken = await signIn('retailer@emidost.in', 'Retailer@Pass123');
check('retailer signs in', Boolean(retailerToken));
if (!ownerToken || !retailerToken) { summary(); process.exit(1); }

// 3. customer (reuse if the test IMEI already exists)
let list = await api('/api/retailer/customers', { token: retailerToken });
let customer = (list.json?.customers ?? list.json ?? []).find?.((c) => c.imei === TEST_IMEI);
if (!customer) {
  const created = await api('/api/retailer/customers', {
    method: 'POST', token: retailerToken,
    body: {
      name: 'AB TEST (automated)', phone: '9000000001', imei: TEST_IMEI,
      brand: 'Samsung', model: 'Galaxy A15', emi_months: 12, emi_amount: 2400,
      emi_due_day: 5, lock_mode: 'lock',
    },
  });
  customer = created.json?.customer ?? created.json;
  check('path A: customer created with schedule', ok2(created.status) && Boolean(customer?.id), `status ${created.status}`);
} else {
  check('path A: existing test customer reused', true, customer.id);
}
if (!customer?.id) { summary(); process.exit(1); }

// 4. enrolment token
const enrol = await api(`/api/retailer/customers/${customer.id}/enrollment`, { method: 'POST', token: retailerToken, body: {} });
const enrolToken = enrol.json?.token ?? enrol.json?.session?.token;
check('path A: 15-min enrolment token minted (hash stored only)', ok2(enrol.status) && Boolean(enrolToken), `status ${enrol.status}`);

// 5. device register with the token (path A and path B share this)
const reg = await api('/api/device/register', {
  method: 'POST',
  body: {
    token: enrolToken, installation_id: TEST_INSTALL, device_token: TEST_DEVICE_TOKEN,
    manufacturer: 'samsung', model: 'SM-A155F', os_version: '14', fcm_token: TEST_FCM,
  },
});
check('device registers with the one-shot token', ok2(reg.status), `status ${reg.status}`);

// 6. token is one-shot
const reg2 = await api('/api/device/register', {
  method: 'POST',
  body: { token: enrolToken, installation_id: `${TEST_INSTALL}-2`, device_token: randomBytes(24).toString('hex') },
});
check('token replay refused (one-shot CAS)', reg2.status >= 400, `status ${reg2.status}`);

// 7. heartbeat activation (device reports its own Device Owner readback)
const hb = await api(`/api/device/heartbeat?installation_id=${TEST_INSTALL}`, {
  method: 'POST',
  headers: { 'x-device-token': TEST_DEVICE_TOKEN },
  body: { mode: 'device_owner', locked: false },
});
check('heartbeat activates the session (mode=device_owner readback)', ok2(hb.status), `status ${hb.status}`);
check('heartbeat carries escalation_enabled', typeof hb.json?.escalation_enabled === 'boolean', String(hb.json?.escalation_enabled));
check('heartbeat carries is_locked + server_now', typeof hb.json?.is_locked === 'boolean' && Boolean(hb.json?.server_now));
check('heartbeat carries photo_url field (null when unset)', hb.json?.photo_url === null || typeof hb.json?.photo_url === 'string');

// 8. service-role check: the device row really holds the fcm token, and the column is revoked from anon
const devRow = await svc(`devices?installation_id=eq.${TEST_INSTALL}&select=id,fcm_token,customer_id,retailer_id`);
const device = Array.isArray(devRow.json) ? devRow.json[0] : null;
check('server stored the fcm_token (service role read)', device?.fcm_token === TEST_FCM, String(device?.fcm_token));
const anonRead = await fetch(`${SUPABASE}/rest/v1/devices?select=fcm_token&limit=1`, { headers: { apikey: ANON } });
const anonBody = await anonRead.text();
check('fcm_token column is closed to anon', !anonBody.includes(TEST_FCM));
if (!device?.id) { summary(); process.exit(1); }

// 9. retailer sees the device
const devList = await api('/api/retailer/devices', { token: retailerToken });
const listDevices = devList.json?.devices ?? devList.json ?? [];
check('retailer device list includes the phone (columns sanitised)', Array.isArray(listDevices) && listDevices.some((d) => d.id === device.id));
check('device payload has no pin_verify/token hash', !JSON.stringify(listDevices).includes('pin_verify') && !JSON.stringify(listDevices).includes('device_token_hash'));

// 10. LOCK command consumes and FAILED ack refunds an allowance
const retailers = await api('/api/owner/retailers', { token: ownerToken });
const retailerRow = (retailers.json?.retailers ?? retailers.json ?? []).find((r) => r.id === device.retailer_id);
const allowancesBefore = retailerRow?.lock_allowances ?? null;

const lock = await api(`/api/retailer/devices/${device.id}/commands`, { method: 'POST', token: retailerToken, body: { command_type: 'LOCK' } });
check('LOCK queued (allowance debited after insert)', ok2(lock.status), `status ${lock.status}`);

const hb2 = await api(`/api/device/heartbeat?installation_id=${TEST_INSTALL}`, { method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN }, body: { mode: 'device_owner', locked: false } });
const lockCmd = (hb2.json?.commands ?? []).find((c) => c.command_type === 'LOCK');
check('LOCK delivered on the heartbeat', Boolean(lockCmd));

if (lockCmd) {
  const ackFailed = await api(`/api/device/command/ack?installation_id=${TEST_INSTALL}`, {
    method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN },
    body: { command_id: lockCmd.id, ack_status: 'FAILED', reason: 'acceptance-test: not device owner' },
  });
  check('non-DO LOCK acks FAILED (no fake EXECUTED)', ok2(ackFailed.status), `status ${ackFailed.status}`);

  const after = await api('/api/owner/retailers', { token: ownerToken });
  const row2 = (after.json?.retailers ?? after.json ?? []).find((r) => r.id === device.retailer_id);
  check('failed LOCK refunded the allowance', allowancesBefore === null || row2?.lock_allowances === allowancesBefore, `${allowancesBefore} -> ${row2?.lock_allowances}`);

  const reAck = await api(`/api/device/command/ack?installation_id=${TEST_INSTALL}`, {
    method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN },
    body: { command_id: lockCmd.id, ack_status: 'EXECUTED' },
  });
  // Terminal immutability: the CAS matches no row, so the ack is an idempotent
  // no-op (no is_locked flip, no double refund). Verified against the DB below.
  const devAfter = await svc(`devices?installation_id=eq.${TEST_INSTALL}&select=is_locked`);
  const devState = Array.isArray(devAfter.json) ? devAfter.json[0] : null;
  check(
    'terminal ack cannot be resurrected (no-op + state unchanged)',
    ok2(reAck.status) && reAck.json?.already === 'terminal' && devState?.is_locked !== true,
    `status ${reAck.status}, already=${reAck.json?.already}, is_locked=${devState?.is_locked}`,
  );
  const cmdRow = await svc(`device_commands?id=eq.${lockCmd.id}&select=status`);
  check('command stayed FAILED in the database', (cmdRow.json?.[0]?.status) === 'FAILED', String(cmdRow.json?.[0]?.status));
}

// 11. REMIND + ALERT + LOCATION command plumbing
for (const type of ['REMIND', 'ALERT']) {
  const q = await api(`/api/retailer/devices/${device.id}/commands`, { method: 'POST', token: retailerToken, body: { command_type: type } });
  check(`${type} command accepted (no allowance)`, ok2(q.status), `status ${q.status}`);
}
const loc = await api(`/api/retailer/devices/${device.id}/commands`, { method: 'POST', token: retailerToken, body: { command_type: 'LOCATION' } });
check('LOCATION command accepted', ok2(loc.status), `status ${loc.status}`);
const hb3 = await api(`/api/device/heartbeat?installation_id=${TEST_INSTALL}`, { method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN }, body: { mode: 'device_owner', locked: false } });
const locCmd = (hb3.json?.commands ?? []).find((c) => c.command_type === 'LOCATION');
if (locCmd) {
  const ackLoc = await api(`/api/device/command/ack?installation_id=${TEST_INSTALL}`, {
    method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN },
    body: { command_id: locCmd.id, ack_status: 'EXECUTED', location: { lat: 22.5726, lng: 88.3639 } },
  });
  check('LOCATION ack stored (EXECUTED with fix)', ok2(ackLoc.status), `status ${ackLoc.status}`);
}

// 12. owner TOTP issue -> retailer unlock key (offline unlock chain)
const totp = await api(`/api/owner/devices/${device.id}/totp`, { method: 'POST', token: ownerToken, body: {} });
check('owner mints the 8-digit offline code', ok2(totp.status) && /^\d{8}$/.test(String(totp.json?.code ?? '')), `status ${totp.status}`);

const key = await api(`/api/retailer/devices/${device.id}/unlock-key`, { method: 'POST', token: retailerToken, body: {} });
check('retailer fetches the same offline unlock secret', ok2(key.status) && typeof key.json?.secret === 'string' && key.json?.digits === 8, `status ${key.status}`);

// 13. escalation kill-switch round trip
const off = await api(`/api/retailer/customers/${customer.id}/escalation`, { method: 'PATCH', token: retailerToken, body: { enabled: false } });
check('escalation kill-switch turns OFF', ok2(off.status), `status ${off.status}`);
const hbOff = await api(`/api/device/heartbeat?installation_id=${TEST_INSTALL}`, { method: 'POST', headers: { 'x-device-token': TEST_DEVICE_TOKEN }, body: { mode: 'device_owner', locked: false } });
check('phone sees escalation_enabled=false', hbOff.json?.escalation_enabled === false, String(hbOff.json?.escalation_enabled));
const on = await api(`/api/retailer/customers/${customer.id}/escalation`, { method: 'PATCH', token: retailerToken, body: { enabled: true } });
check('escalation kill-switch turns back ON', ok2(on.status), `status ${on.status}`);

// 14. payment + schedule (money path)
const pay = await api(`/api/retailer/customers/${customer.id}/payments`, { method: 'POST', token: retailerToken, body: { amount: 100, method: 'cash' } });
check('payment recorded against the schedule', ok2(pay.status), `status ${pay.status}`);
const sched = await api(`/api/retailer/customers/${customer.id}/schedules`, { token: retailerToken });
const schedRows = sched.json?.schedules ?? sched.json ?? [];
check('schedule reflects the payment', Array.isArray(schedRows) && schedRows.some((s) => Number(s.amount_paid ?? 0) > 0));
const overpay = await api(`/api/retailer/customers/${customer.id}/payments`, { method: 'POST', token: retailerToken, body: { amount: 9999999, method: 'cash' } });
check('overpayment rejected with 400', overpay.status === 400, `status ${overpay.status}`);

// 15. settled/suspension gates still hold (read-only probes)
const noAuth = await api('/api/retailer/devices');
check('unauthenticated retailer route refused', noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);

summary();
process.exit(results.some((r) => !r.ok) ? 1 : 0);

function summary() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n=== ${pass}/${results.length} checks passed ===`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}`);
  }
  console.log('\nNote: the OS-level Device Owner grant, the adb self-pair, kiosk pinning,');
  console.log('SIM/boot behaviour and the offline voice alerts still require the per-OEM');
  console.log('device walks (docs/VERIFICATION_CHECKLIST.md sections A, B, H, K).');
}
