import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { bad } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Device registration: the customer app binds its installation to an enrolment
 * session. Consent + session preconditions were enforced at creation time.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token: string | undefined = body?.token;
  const installationId: string | undefined = body?.installation_id;
  const manufacturer: string | undefined = body?.manufacturer;
  const model: string | undefined = body?.model;
  const osVersion: string | undefined = body?.os_version;
  const deviceToken: string | undefined = body?.device_token;
  if (!token || !installationId || !deviceToken) return bad('token, installation_id and device_token required');

  const svc = serviceClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: session } = await svc.from('enrollment_sessions')
    .select('id, retailer_id, customer_id, state, expires_at')
    .eq('token_hash', tokenHash).maybeSingle();
  if (!session) return bad('Invalid or used enrolment token');
  if (new Date(session.expires_at).getTime() < Date.now()) return bad('Enrolment session expired');
  if (session.state === 'active' || session.state === 'expired') return bad('Session already used');

  // Takeover guard: the installation id may already exist; it must belong to
  // this session's retailer, otherwise the token cannot re-point it.
  const { data: existing } = await svc.from('devices')
    .select('retailer_id').eq('installation_id', installationId).maybeSingle();
  if (existing && existing.retailer_id !== session.retailer_id) {
    return bad('This installation id belongs to another retailer');
  }

  const { data: device, error } = await svc.from('devices')
    .upsert({
      installation_id: installationId,
      retailer_id: session.retailer_id,
      customer_id: session.customer_id,
      manufacturer: manufacturer ?? null,
      model: model ?? null,
      os_version: osVersion ?? null,
      device_token_hash: createHash('sha256').update(deviceToken).digest('hex'),
      consent_record_id: null,
    }, { onConflict: 'installation_id' })
    .select().single();
  if (error || !device) return Response.json({ error: error?.message ?? 'device upsert failed' }, { status: 500 });

  await svc.from('enrollment_sessions').update({ state: 'installed' }).eq('id', session.id);
  await svc.from('audit_log').insert({
    retailer_id: session.retailer_id, event: 'DEVICE_REGISTERED',
    detail: { device_id: device.id, installation_id: installationId, manufacturer, model },
  });
  return Response.json({ device_id: device.id, customer_code: null }, { status: 201 });
}
