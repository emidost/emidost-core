import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Retailer LOCK/UNLOCK. LOCK consumes one lock allowance (atomic decrement;
 * refused when the balance is zero). Hard-lock-only: the device must be a
 * verified Device Owner before the phone will act; the command itself is
 * queued and the device re-verifies its own state.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const body = await req.json().catch(() => ({}));
  const commandType: string | undefined = body?.command_type;
  if (commandType !== 'LOCK' && commandType !== 'UNLOCK' && commandType !== 'LOCATION') {
    return bad('command_type must be LOCK, UNLOCK or LOCATION');
  }

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, retailer_id, customer_id, customers(status)')
    .eq('id', params.id).maybeSingle();
  if (!device || device.retailer_id !== profile.retailer_id) return bad('Device not found');
  if (!device.customer_id) return bad('Device is not bound to a customer');

  // Paid loans can never be locked again; UNLOCK/RELEASE stay available.
  const customer = device.customers as unknown as { status: string } | null;
  if (commandType === 'LOCK' && customer && (customer.status === 'COMPLETE' || customer.status === 'SETTLED')) {
    return bad('This loan is settled. Locking is disabled.');
  }

  // Insert the command first; the allowance debit follows only on success.
  const { data, error } = await svc.from('device_commands').insert({
    device_id: device.id, retailer_id: device.retailer_id,
    command_type: commandType, payload: body.payload ?? {}, created_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'command insert failed' }, { status: 500 });

  if (commandType === 'LOCK') {
    const { data: newBalance } = await svc.rpc('decrement_allowance', { rid: profile.retailer_id });
    if (newBalance === null || newBalance === undefined) {
      // Roll back the command: the retailer has no allowance for it.
      await svc.from('device_commands').update({ status: 'CANCELLED' }).eq('id', data.id);
      return bad('No lock allowances left. Ask the owner to top up.');
    }
    const { error: ledgerErr } = await svc.from('credit_ledger').insert({
      retailer_id: profile.retailer_id, kind: 'lock_consumed', delta: -1,
      balance_after: Number(newBalance), by_profile: profile.id,
    });
    if (ledgerErr) {
      // Compensation (honest note): the allowance was already debited; a failed
      // ledger row would leave it unrecovered. Give the allowance back, cancel
      // the command, and audit. The refund's own ledger row is best-effort —
      // the same DB fault that failed the first insert may fail it too.
      const { data: refunded } = await svc.rpc('increment_allowance', { rid: profile.retailer_id });
      if (refunded != null) {
        // Best-effort: the refund ledger row is attempted but never awaited on
        // failure — supabase-js query builders are thenables, not promises
        // with .catch, so use the two-arg .then form (workers tsc compiles
        // this file too).
        await svc.from('credit_ledger').insert({
          retailer_id: profile.retailer_id, kind: 'lock_refund', delta: 1,
          balance_after: Number(refunded), by_profile: profile.id,
        }).then(() => {}, () => {});
      }
      await svc.from('device_commands').update({ status: 'CANCELLED' }).eq('id', data.id);
      await svc.from('audit_log').insert({
        actor_id: profile.id, retailer_id: device.retailer_id,
        event: 'COMMAND_CANCELLED',
        detail: { device_id: device.id, command_id: data.id, reason: 'ledger insert failed; allowance refunded' },
      });
      return Response.json({ error: 'Lock command cancelled: the ledger write failed and the allowance was refunded. Retry the lock.' }, { status: 500 });
    }
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: device.retailer_id,
    event: 'COMMAND_ISSUED', detail: { device_id: device.id, command_type: commandType, command_id: data.id },
  });
  return Response.json(data, { status: 201 });
}
