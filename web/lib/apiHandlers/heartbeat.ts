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
    .select('id, customer_id, retailer_id, device_token_hash, device_pin_hash, pin_verify, is_locked, mode, hidden_state, last_heartbeat_at, fcm_token, customers(status, customer_code, lock_mode, emi_amount, emi_months, emi_due_day, photo_path, overdue_escalation_enabled), retailers(phone, is_suspended, name)')
    .eq('installation_id', installationId).maybeSingle();
  if (!device || !device.device_token_hash) return Response.json({ error: 'unknown device' }, { status: 401 });
  const tokenHash = createHash('sha256').update(deviceToken).digest('hex');
  if (tokenHash !== device.device_token_hash) return Response.json({ error: 'bad token' }, { status: 401 });

  const retailers = device.retailers as unknown as { phone: string | null; is_suspended: boolean | null; name: string | null } | null;
  const customers = device.customers as unknown as { status: string; customer_code: string | null; lock_mode: 'lock' | 'notify_only' | null; emi_amount: number | null; emi_months: number | null; emi_due_day: number | null; photo_path: string | null; overdue_escalation_enabled: boolean | null } | null;
  const suspended = retailers?.is_suspended === true;

  // Device-reported live state. Promotion to device_owner requires an open
  // enrolment session for this customer (the client cannot self-promote).
  const body = await req.json().catch(() => ({}));
  // The phone reports DeviceActions.mode() in upper case (DEVICE_OWNER).
  const reportedMode = typeof body?.mode === 'string' ? body.mode.toLowerCase() : '';
  if (reportedMode === 'device_admin' && device.mode !== 'device_admin') {
    await svc.from('devices').update({ mode: reportedMode }).eq('id', device.id);
  }
  if (reportedMode === 'device_owner' && device.mode !== 'device_owner') {
    const { data: openSessions } = await svc.from('enrollment_sessions')
      .select('id').eq('customer_id', device.customer_id)
      .in('state', ['created', 'installed', 'connected', 'owner_verified', 'access_verified', 'finalizing'])
      .limit(1);
    if (openSessions && openSessions.length > 0) {
      await svc.from('devices').update({ mode: 'device_owner' }).eq('id', device.id);
      // Same state list as the open-session check above: a session still in
      // 'created' (e.g. DPC provisioning finished before the register call)
      // must also activate and consume the credit exactly once.
      const { data: activated } = await svc.from('enrollment_sessions')
        .update({ state: 'active' })
        .eq('customer_id', device.customer_id)
        .in('state', ['created', 'installed', 'connected', 'owner_verified', 'access_verified', 'finalizing'])
        .select('id');
      // A real activation consumes one device credit, exactly once (CAS above).
      if (activated && activated.length > 0) {
        const rid = device.retailer_id;
        if (rid) {
          const { data: balance } = await svc.rpc('consume_device_credit', { rid });
          if (balance != null) {
            await svc.from('credit_ledger').insert({
              retailer_id: rid, kind: 'slot_consumed', delta: -1, balance_after: Number(balance), device_id: device.id,
            });
          }
        }
      }
    }
  }

  // Lazy sweeper (one-time refunds, CAS on status): a command that sits
  // PENDING/RECEIVED for over 24 h will never be executed; expire it and, for
  // LOCK, refund the allowance debited at queue time. A dead device therefore
  // cannot hold the retailer's allowance forever.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: staleRows } = await svc.from('device_commands')
    .select('id, command_type')
    .eq('device_id', device.id)
    .in('status', ['PENDING', 'RECEIVED'])
    .lt('created_at', staleCutoff);
  for (const stale of staleRows ?? []) {
    const { data: expired } = await svc.from('device_commands')
      .update({ status: 'EXPIRED', acked_at: new Date().toISOString() })
      .eq('id', stale.id).in('status', ['PENDING', 'RECEIVED'])
      .select('id').maybeSingle();
    if (expired && stale.command_type === 'LOCK') {
      const { data: refunded } = await svc.rpc('increment_allowance', { rid: device.retailer_id });
      if (refunded != null) {
        await svc.from('credit_ledger').insert({
          retailer_id: device.retailer_id, kind: 'lock_refund', delta: 1, balance_after: Number(refunded),
        });
      }
    }
  }

  // FCM/Expo wake token: stored/rotated here in the SAME parallel update wave
  // as last_heartbeat_at (no extra round trip). `fcm_token: null` in the body
  // clears the stored token (e.g. the phone lost push registration).
  const heartbeatUpdate: Record<string, string | null> = { last_heartbeat_at: new Date().toISOString() };
  const bodyFcm = body?.fcm_token;
  if (typeof bodyFcm === 'string' && bodyFcm.length <= 200 && bodyFcm !== device.fcm_token) {
    heartbeatUpdate.fcm_token = bodyFcm.length > 0 ? bodyFcm : null;
    heartbeatUpdate.fcm_token_updated_at = bodyFcm.length > 0 ? new Date().toISOString() : null;
  } else if (bodyFcm === null && device.fcm_token) {
    heartbeatUpdate.fcm_token = null;
    heartbeatUpdate.fcm_token_updated_at = null;
  }

  // Customer photo: one signed-URL call per poll, only when a photo exists.
  // Storage failure → null (the photo is a UX nicety, never a lock dependency).
  const photoUrlPromise = customers?.photo_path
    ? svc.storage.from('customer-photos')
        .createSignedUrl(customers.photo_path, 86400)
        .then(({ data }) => data?.signedUrl ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  // One parallel wave: the pending select includes both PENDING and RECEIVED,
  // so it does not need to wait for the mark-RECEIVED update.
  const [, pendingRes, totpRow, dueRows, photoUrl] = await Promise.all([
    svc.from('devices').update(heartbeatUpdate).eq('id', device.id),
    svc.from('device_commands')
      .select('id, command_type, payload, created_at, status')
      .eq('device_id', device.id).in('status', ['PENDING', 'RECEIVED']).order('created_at'),
    svc.from('totp_secrets').select('secret_enc').eq('device_id', device.id).maybeSingle(),
    device.customer_id
      ? svc.from('emi_schedules')
          .select('due_date, amount_due, status').eq('customer_id', device.customer_id)
          .in('status', ['PENDING', 'PARTIAL', 'OVERDUE']).order('due_date').limit(1)
      : Promise.resolve({ data: null }),
    photoUrlPromise,
  ]);
  const pendingRows = pendingRes.data ?? [];
  // A suspended retailer cannot issue restrictive commands, but authorized
  // recovery (UNLOCK/RELEASE) always reaches the device.
  const deliverable = suspended
    ? pendingRows.filter((c) => c.command_type === 'UNLOCK' || c.command_type === 'RELEASE')
    : pendingRows;
  const toMark = deliverable.filter((c) => c.status === 'PENDING').map((c) => c.id);
  if (toMark.length > 0) {
    await svc.from('device_commands').update({ status: 'RECEIVED' })
      .in('id', toMark).eq('status', 'PENDING');
  }

  // Device-reported enforcedLocked readback → portal lock indicator. Report
  // true → is_locked=true. Report false → clear ONLY when no LOCK/DEVICE_ACTION
  // is still PENDING/RECEIVED (a queued lock may not have executed on the
  // phone yet; clearing early would show a false "unlocked"). Settled loans
  // are skipped: their device may hold the documented 5-day watchdog lock
  // while offline, and a paid-off phone must never read "Locked" server-side.
  const settledLoan = customers?.status === 'COMPLETE' || customers?.status === 'SETTLED';
  if (!settledLoan && typeof body?.locked === 'boolean') {
    const hasPendingRestrictive = pendingRows.some(
      (c) => c.command_type === 'LOCK' || c.command_type === 'DEVICE_ACTION',
    );
    if (body.locked === true) {
      await svc.from('devices').update({ is_locked: true }).eq('id', device.id);
    } else if (body.locked === false && !hasPendingRestrictive) {
      await svc.from('devices').update({ is_locked: false }).eq('id', device.id);
    }
  }

  const frpAccounts = (process.env.EXPO_PUBLIC_FRP_ACCOUNTS ?? '')
    .split(',').map((s: string) => s.trim()).filter(Boolean);

  const nextDue = dueRows?.data?.[0] ?? null;
  // Overdue truth derives from the due date itself (PENDING rows past their
  // date are overdue even before any updater marks them). Due dates are
  // calendar days in Asia/Calcutta (IST, UTC+05:30), so parse them with the
  // explicit offset instead of the server's own timezone.
  const overdueDays = nextDue
    ? Math.max(0, Math.floor((Date.now() - new Date(nextDue.due_date + 'T00:00:00+05:30').getTime()) / 86_400_000))
    : 0;

  return Response.json({
    commands: deliverable,
    device_pin_hash: device.device_pin_hash ?? null,
    pin_verify: device.pin_verify ?? null,
    totp_secret: totpRow?.data?.secret_enc ? decryptTotpSecret(totpRow.data.secret_enc) : null,
    frp_accounts: frpAccounts,
    loan_status: customers?.status ?? '',
    customer_code: customers?.customer_code ?? null,
    lock_mode: customers?.lock_mode ?? 'lock',
    emi_amount: customers?.emi_amount ?? null,
    emi_months: customers?.emi_months ?? null,
    emi_due_day: customers?.emi_due_day ?? null,
    photo_url: photoUrl,
    escalation_enabled: customers?.overdue_escalation_enabled ?? true,
    retailer_phone: retailers?.phone ?? null,
    retailer_name: retailers?.name ?? null,
    retailer_suspended: suspended,
    is_locked: device.is_locked,
    next_due: nextDue,
    overdue_days: overdueDays,
    server_now: new Date().toISOString(),
    // Server knows only what it configured; the device reports the real OS
    // state via its own readback. No fake "all true" policy map.
    policies: {},
  });
}
