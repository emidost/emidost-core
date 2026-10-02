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
  if (commandType !== 'LOCK' && commandType !== 'UNLOCK') return bad('command_type must be LOCK or UNLOCK');

  const svc = serviceClient();
  const { data: device } = await svc.from('devices').select('id, retailer_id, customer_id, is_locked')
    .eq('id', params.id).maybeSingle();
  if (!device || device.retailer_id !== profile.retailer_id) return bad('Device not found');
  if (!device.customer_id) return bad('Device is not bound to a customer');

  // Paid loans can never be locked again.
  const { data: customer } = await svc.from('customers').select('status').eq('id', device.customer_id).maybeSingle();
  if (customer && (customer.status === 'COMPLETE' || customer.status === 'SETTLED')) {
    return bad('This loan is settled. Locking is disabled.');
  }

  if (commandType === 'LOCK') {
    const { data: newBalance } = await svc.rpc('decrement_allowance', { rid: profile.retailer_id });
    if (newBalance === null || newBalance === undefined) {
      return bad('No lock allowances left. Ask the owner to top up.');
    }
    await svc.from('credit_ledger').insert({
      retailer_id: profile.retailer_id, kind: 'lock_consumed', delta: -1,
      balance_after: Number(newBalance), by_profile: profile.id,
    });
  }

  const { data, error } = await svc.from('device_commands').insert({
    device_id: device.id, retailer_id: device.retailer_id,
    command_type: commandType, payload: body.payload ?? {}, created_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'command insert failed' }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: device.retailer_id,
    event: 'COMMAND_ISSUED', detail: { device_id: device.id, command_type: commandType, command_id: data.id },
  });
  return Response.json(data, { status: 201 });
}
