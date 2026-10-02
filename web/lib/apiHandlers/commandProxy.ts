import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';
import { sendKick } from '@/lib/fcm';

export const dynamic = 'force-dynamic';

/**
 * Owner LOCK/UNLOCK/LOCATION/RELEASE/REBOOT (never consumes allowances).
 * REBOOT is owner-only by design: the device refuses it while locked
 * (native guard), so it is a recovery affordance, not a retailer tool.
 */
export async function POST(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const deviceId: string | undefined = body?.device_id;
  const commandType: string | undefined = body?.command_type;
  if (!deviceId || !['LOCK', 'UNLOCK', 'LOCATION', 'RELEASE', 'REBOOT'].includes(commandType ?? '')) {
    return bad('device_id + command_type (LOCK, UNLOCK, LOCATION, RELEASE or REBOOT) required');
  }

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, retailer_id, customer_id, fcm_token, customers(status)').eq('id', deviceId).maybeSingle();
  if (!device) return bad('Device not found');
  const customer = device.customers as unknown as { status: string } | null;
  if (commandType === 'LOCK' && customer && (customer.status === 'COMPLETE' || customer.status === 'SETTLED')) {
    return bad('This loan is settled. Locking is disabled.');
  }
  const { data, error } = await svc.from('device_commands').insert({
    device_id: device.id, retailer_id: device.retailer_id, command_type: commandType,
    payload: body.payload ?? {}, created_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'command insert failed' }, { status: 500 });

  // Wake-only push kick (best-effort accelerator); never blocks the response.
  if (device.fcm_token) {
    void sendKick(device.fcm_token).then((r) => {
      if (!r.ok) console.error(`[push] kick failed for device ${device.id}: ${r.error}`);
    });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: device.retailer_id,
    event: 'COMMAND_ISSUED',
    detail: {
      device_id: device.id, command_type: commandType, command_id: data.id, by: 'owner',
      push_kick: device.fcm_token ? 'attempted' : 'skipped',
    },
  });
  return Response.json(data, { status: 201 });
}
