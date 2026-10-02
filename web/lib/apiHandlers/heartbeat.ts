import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabaseServer';
import { decryptTotpSecret } from '@/lib/totpCrypto';
import { deviceRateKey, rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Heartbeat: the only polling channel for the customer app. Returns pending
 * commands, the device PIN verify hash, FRP accounts, loan status, retailer
 * phone, next due, and server_now (for the unlock-wins watermark). The device
 * reports its own OS readback; the server never fabricates policy states.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(deviceRateKey(req), 120, 60_000)) {
    return Response.json({ error: 'too many requests' }, { status: 429 });
  }
  const installationId = req.nextUrl.searchParams.get('installation_id');
  const deviceToken = req.headers.get('x-device-token');
  if (!installationId || !deviceToken) return Response.json({ error: 'missing auth' }, { status: 401 });

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, customer_id, retailer_id, device_token_hash, device_pin_hash, pin_verify, is_locked, mode, hidden_state, last_heartbeat_at, customers(status, customer_code), retailers(phone, is_suspended)')
    .eq('installation_id', installationId).maybeSingle();
  if (!device || !device.device_token_hash) return Response.json({ error: 'unknown device' }, { status: 401 });
  const tokenHash = createHash('sha256').update(deviceToken).digest('hex');
  if (tokenHash !== device.device_token_hash) return Response.json({ error: 'bad token' }, { status: 401 });

  const retailers = device.retailers as unknown as { phone: string | null; is_suspended: boolean | null } | null;
  const customers = device.customers as unknown as { status: string; customer_code: string | null } | null;
  const suspended = retailers?.is_suspended === true;

  // Device-reported live state. Promotion to device_owner requires an open
  // enrolment session for this customer (the client cannot self-promote).
  const body = await req.json().catch(() => ({}));
  if (body?.mode === 'device_admin') {
    await svc.from('devices').update({ mode: body.mode }).eq('id', device.id);
  }
  if (body?.mode === 'device_owner') {
    const { data: openSession } = await svc.from('enrollment_sessions')
      .select('id').eq('customer_id', device.customer_id)
      .in('state', ['created', 'installed', 'connected', 'owner_verified', 'access_verified', 'finalizing'])
      .maybeSingle();
    if (openSession) {
      await svc.from('devices').update({ mode: 'device_owner' }).eq('id', device.id);
      await svc.from('enrollment_sessions')
        .update({ state: 'active' })
        .eq('customer_id', device.customer_id)
        .in('state', ['installed', 'connected', 'finalizing']);
    }
  }

  // Parallelize the independent hot-path updates/reads (3 waves â†’ 2).
  const [_, pendingUpdate, totpRow, dueRows] = await Promise.all([
    svc.from('devices').update({ last_heartbeat_at: new Date().toISOString() }).eq('id', device.id),
    svc.from('device_commands')
      .update({ status: 'RECEIVED' })
      .eq('device_id', device.id).eq('status', 'PENDING'),
    svc.from('totp_secrets').select('secret_enc').eq('device_id', device.id).maybeSingle(),
    device.customer_id
      ? svc.from('emi_schedules')
          .select('due_date, amount_due, status').eq('customer_id', device.customer_id)
          .in('status', ['PENDING', 'PARTIAL', 'OVERDUE']).order('due_date').limit(1)
      : Promise.resolve({ data: null }),
  ]);

  const { data: pendingRows } = await svc.from('device_commands')
    .select('id, command_type, payload, created_at, status')
    .eq('device_id', device.id).in('status', ['PENDING', 'RECEIVED']).order('created_at');

  const frpAccounts = (process.env.EXPO_PUBLIC_FRP_ACCOUNTS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const nextDue = dueRows?.data?.[0] ?? null;
  const overdueDays = nextDue && nextDue.status !== 'PENDING'
    ? Math.max(0, Math.floor((Date.now() - new Date(nextDue.due_date).getTime()) / 86_400_000))
    : 0;

  return Response.json({
    // A suspended retailer cannot issue restrictive commands, but authorized
    // recovery (UNLOCK/RELEASE) always reaches the device.
    commands: suspended
      ? (pendingRows ?? []).filter((c) => c.command_type === 'UNLOCK' || c.command_type === 'RELEASE')
      : pendingRows ?? [],
    device_pin_hash: device.device_pin_hash ?? null,
    pin_verify: device.pin_verify ?? null,
    totp_secret: totpRow?.data?.secret_enc ? decryptTotpSecret(totpRow.data.secret_enc) : null,
    frp_accounts: frpAccounts,
    loan_status: customers?.status ?? '',
    customer_code: customers?.customer_code ?? null,
    retailer_phone: retailers?.phone ?? null,
    retailer_suspended: suspended,
    next_due: nextDue,
    overdue_days: overdueDays,
    server_now: new Date().toISOString(),
    // Server knows only what it configured; the device reports the real OS
    // state via its own readback. No fake "all true" policy map.
    policies: {},
  });
}
