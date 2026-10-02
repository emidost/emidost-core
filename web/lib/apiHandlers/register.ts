import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { bad } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';
import { deviceRateKey, rateLimit, sharedRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Device registration: the customer app binds its installation to an enrolment
 * session. Consent + session preconditions were enforced at creation time.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(deviceRateKey(req), 20, 60_000) || !(await sharedRateLimit(deviceRateKey(req), 20, 60_000))) {
    return Response.json({ error: 'too many requests' }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  // The token is lowercase hex; phones may type it upper-cased.
  const token: string | undefined = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : undefined;
  const installationId: string | undefined = body?.installation_id;
  const manufacturer: string | undefined = body?.manufacturer;
  const model: string | undefined = body?.model;
  const osVersion: string | undefined = body?.os_version;
  const deviceToken: string | undefined = body?.device_token;
  if (!token || !installationId || !deviceToken) return bad('token, installation_id and device_token required');

  const svc = serviceClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: session } = await svc.from('enrollment_sessions')
    .select('id, retailer_id, customer_id, state, expires_at, customers(status), retailers(is_suspended)')
    .eq('token_hash', tokenHash).maybeSingle();
  if (!session) return bad('Invalid or used enrolment token');
  if (new Date(session.expires_at).getTime() < Date.now()) return bad('Enrolment session expired');

  const customers = session.customers as unknown as { status: string } | null;
  const retailers = session.retailers as unknown as { is_suspended: boolean | null } | null;
  if (retailers?.is_suspended === true) return bad('Retailer suspended');
  if (customers && (customers.status === 'COMPLETE' || customers.status === 'SETTLED')) {
    return bad('This loan is settled; re-enrolment is not allowed');
  }

  // Takeover guard, checked before the token is spent: the installation id may
  // already exist; it must belong to this session's retailer, otherwise the
  // token cannot re-point it.
  const { data: existing } = await svc.from('devices')
    .select('retailer_id').eq('installation_id', installationId).maybeSingle();
  if (existing && existing.retailer_id !== session.retailer_id) {
    return bad('This installation id belongs to another retailer');
  }

  // Atomic one-shot consumption: only the CREATED state transitions.
  const { data: consumed } = await svc.from('enrollment_sessions')
    .update({ state: 'installed' })
    .eq('id', session.id).eq('state', 'created')
    .select('id').maybeSingle();
  if (!consumed) return bad('Enrolment token already used');

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

  await svc.from('audit_log').insert({
    retailer_id: session.retailer_id, event: 'DEVICE_REGISTERED',
    detail: { device_id: device.id, installation_id: installationId, manufacturer, model },
  });
  return Response.json({ device_id: device.id, customer_code: null }, { status: 201 });
}
