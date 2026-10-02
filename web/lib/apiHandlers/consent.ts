import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const CONSENT_TEXT = 'This phone is financed on EMI through emidost. Locking, device protection and remote management stay active until the EMI is fully paid. The retailer explained this and I agree.';

/**
 * Consent is a PRECONDITION of enrolment. This route records it; the enrolment
 * route refuses to create a session without a consent record for the customer.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const body = await req.json().catch(() => ({}));
  const lang = ['en', 'bn', 'hi'].includes(body.lang) ? body.lang : 'en';
  const otpAck = body.otp_ack === true;

  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) return bad('Customer not found');

  const { data, error } = await svc.from('consent_records').insert({
    customer_id: customer.id,
    lang,
    text_hash: createHash('sha256').update(CONSENT_TEXT).digest('hex'),
    text_version: 1,
    otp_ack: otpAck,
    signature_ref: typeof body.signature_ref === 'string' ? body.signature_ref : null,
    recorded_by: profile.id,
  }).select('id').single();
  if (error || !data) return Response.json({ error: error?.message ?? 'consent insert failed' }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'CONSENT_RECORDED', detail: { customer_id: customer.id, consent_id: data.id, lang },
  });
  return Response.json({ consent_id: data.id, text: CONSENT_TEXT }, { status: 201 });
}
