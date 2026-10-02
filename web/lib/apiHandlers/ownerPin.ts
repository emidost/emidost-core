import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Owner sets the per-device management PIN. The plaintext is never stored:
 * pin_verify = sha256(pin + ":" + installation_id) so the phone can verify
 * the PIN offline. A 4-8 digit PIN is brute-forceable from this hash, so it
 * must never leave the service role except to the device itself.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const pin: string | undefined = body?.pin;
  if (!pin || !/^\d{4,8}$/.test(pin)) return bad('PIN must be 4-8 digits');

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, installation_id').eq('id', params.id).maybeSingle();
  if (!device) return Response.json({ error: 'not found' }, { status: 404 });

  const pinVerify = createHash('sha256').update(`${pin}:${device.installation_id}`).digest('base64');
  const { error } = await svc.from('devices')
    .update({ pin_verify: pinVerify }).eq('id', device.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, event: 'DEVICE_PIN_SET', detail: { device_id: device.id },
  });
  return Response.json({ ok: true });
}
