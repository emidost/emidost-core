import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { serviceClient } from '@/lib/supabaseServer';
import { deviceRateKey, rateLimit, sharedRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Command acknowledgement. Atomic transitions only. LOCK executed flips
 * devices.is_locked; UNLOCK clears it. A settled loan never re-locks.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(deviceRateKey(req), 120, 60_000) || !(await sharedRateLimit(deviceRateKey(req), 120, 60_000))) {
    return Response.json({ error: 'too many requests' }, { status: 429 });
  }
  const installationId = req.nextUrl.searchParams.get('installation_id');
  const deviceToken = req.headers.get('x-device-token');
  const body = await req.json().catch(() => ({}));
  const commandId: string | undefined = body?.command_id;
  const ackStatus: string | undefined = body?.ack_status;
  if (!installationId || !deviceToken || !commandId || !ackStatus) {
    return Response.json({ error: 'installation_id, device_token, command_id, ack_status required' }, { status: 400 });
  }
  const allowed = ['EXECUTED', 'SUPERSEDED', 'FAILED', 'EXPIRED'];
  if (!allowed.includes(ackStatus)) return Response.json({ error: 'bad ack_status' }, { status: 400 });

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, retailer_id, device_token_hash, is_locked, customer_id, customers(status)')
    .eq('installation_id', installationId).maybeSingle();
  if (!device || !device.device_token_hash) return Response.json({ error: 'unknown device' }, { status: 401 });
  if (createHash('sha256').update(deviceToken).digest('hex') !== device.device_token_hash) {
    return Response.json({ error: 'bad token' }, { status: 401 });
  }

  const { data: command } = await svc.from('device_commands')
    .select('id, command_type, status').eq('id', commandId).eq('device_id', device.id).maybeSingle();
  if (!command) return Response.json({ error: 'command not found' }, { status: 404 });
  if (command.status === 'EXECUTED' || command.status === 'SUPERSEDED') {
    return Response.json({ ok: true, already: command.status });
  }

  // Gate-first: a settled loan can never execute a fresh LOCK.
  const customers = device.customers as unknown as { status: string } | null;
  const settled = customers?.status === 'COMPLETE' || customers?.status === 'SETTLED';
  if (command.command_type === 'LOCK' && ackStatus === 'EXECUTED' && settled) {
    await svc.from('device_commands').update({ status: 'SUPERSEDED', acked_at: new Date().toISOString() }).eq('id', command.id);
    return Response.json({ ok: false, reason: 'settled_loan' });
  }

  // Atomic compare-and-set: only PENDING/RECEIVED commands can transition.
  // Terminal states are immutable; a late ack cannot resurrect a cancelled,
  // expired, or failed command.
  const update: Record<string, unknown> = { status: ackStatus, acked_at: new Date().toISOString() };
  if (ackStatus === 'EXECUTED') update.executed_at = new Date().toISOString();
  const { data: transitioned, error: updErr } = await svc.from('device_commands')
    .update(update).eq('id', command.id).in('status', ['PENDING', 'RECEIVED']).select('id').maybeSingle();
  if (updErr) return Response.json({ error: 'ack failed' }, { status: 500 });
  if (!transitioned) return Response.json({ ok: true, already: 'terminal' });

  // Terminal LOCK failures refund the allowance (debited at queue time).
  if (command.command_type === 'LOCK' && (ackStatus === 'FAILED' || ackStatus === 'EXPIRED')) {
    const rid = device.retailer_id;
    if (rid) {
      const { data: refunded } = await svc.rpc('increment_allowance', { rid });
      if (refunded != null) {
        await svc.from('credit_ledger').insert({
          retailer_id: rid, kind: 'slot_refund', delta: 1, balance_after: Number(refunded),
        });
      }
    }
  }

  if (ackStatus === 'EXECUTED' && command.command_type === 'LOCK') {
    await svc.from('devices').update({ is_locked: true }).eq('id', device.id);
  }
  if (ackStatus === 'EXECUTED' && command.command_type === 'UNLOCK') {
    await svc.from('devices').update({ is_locked: false }).eq('id', device.id);
  }
  if (ackStatus === 'EXECUTED' && command.command_type === 'RELEASE') {
    await svc.from('devices').update({ is_locked: false, hidden_state: 'visible' }).eq('id', device.id);
    // Release refunds the device credit exactly once (release_events is unique per customer).
    const { data: rel } = await svc.from('release_events')
      .insert({ customer_id: device.customer_id, triggered_by: 'command_release' })
      .select('id').maybeSingle();
    if (rel) {
      const rid = device.retailer_id;
      if (rid) {
        const { data: refunded } = await svc.rpc('refund_device_credit', { rid });
        if (refunded != null) {
          await svc.from('credit_ledger').insert({
            retailer_id: rid, kind: 'slot_freed', delta: 1, balance_after: Number(refunded),
          });
        }
      }
    }
  }

  // Location is stored only when a LOCATION request was fetched and answered.
  if (ackStatus === 'EXECUTED' && command.command_type === 'LOCATION' && body.location) {
    await svc.from('devices').update({
      last_location: body.location,
      last_location_at: new Date().toISOString(),
    }).eq('id', device.id);
  }

  await svc.from('device_command_acks').insert({
    command_id: command.id, ack_status: ackStatus, reason: body.reason ?? null,
  });
  return Response.json({ ok: true, status: ackStatus });
}
