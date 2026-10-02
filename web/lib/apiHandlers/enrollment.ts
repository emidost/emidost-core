import { createHash, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Creates an enrolment session. A consent record for the customer MUST exist
 * (precondition). Returns the raw token once; only its sha256 is stored.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) return bad('Customer not found');

  // Consent is given directly at the counter; no blocking record is required.
  const body = await req.json().catch(() => ({}));
  const token = randomBytes(24).toString('hex');
  const { data, error } = await svc.from('enrollment_sessions').insert({
    retailer_id: customer.retailer_id,
    customer_id: customer.id,
    device_serial: typeof body.device_serial === 'string' ? body.device_serial : null,
    apk_sha256: typeof body.apk_sha256 === 'string' ? body.apk_sha256 : null,
    token_hash: createHash('sha256').update(token).digest('hex'),
    consent_record_id: null,
    state: 'created',
    created_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'session insert failed' }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'SESSION_CREATED', detail: { session_id: data.id, customer_id: customer.id },
  });
  return Response.json({ ...data, token }, { status: 201 });
}
