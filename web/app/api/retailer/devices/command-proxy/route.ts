import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/** Owner LOCK/UNLOCK (never consumes allowances). */
export async function POST(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const deviceId: string | undefined = body?.device_id;
  const commandType: string | undefined = body?.command_type;
  if (!deviceId || (commandType !== 'LOCK' && commandType !== 'UNLOCK')) return bad('device_id + command_type required');

  const svc = serviceClient();
  const { data: device } = await svc.from('devices').select('id, retailer_id, customer_id').eq('id', deviceId).maybeSingle();
  if (!device) return bad('Device not found');
  const { data: customer } = await svc.from('customers').select('status').eq('id', device.customer_id).maybeSingle();
  if (commandType === 'LOCK' && customer && (customer.status === 'COMPLETE' || customer.status === 'SETTLED')) {
    return bad('This loan is settled. Locking is disabled.');
  }
  const { data, error } = await svc.from('device_commands').insert({
    device_id: device.id, retailer_id: device.retailer_id, command_type: commandType,
    payload: body.payload ?? {}, created_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'command insert failed' }, { status: 500 });
  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: device.retailer_id,
    event: 'COMMAND_ISSUED', detail: { device_id: device.id, command_type: commandType, command_id: data.id, by: 'owner' },
  });
  return Response.json(data, { status: 201 });
}
