import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Retailer attaches the customer's photo. Uploads go to the PRIVATE
 * customer-photos bucket with the service role (no bucket policies), and only
 * the storage path is stored on the customer row. The retailer app shows its
 * local preview; the bound phone receives a signed URL via the heartbeat and
 * caches the file for offline use.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad('Expected multipart form data with a file field named photo');
  }
  const file = form.get('photo');
  if (!(file instanceof File)) return bad('Photo file (field name: photo) is required');
  const type = file.type.toLowerCase();
  const ext = ALLOWED_TYPES.get(type);
  if (!ext) return bad('Photo must be a JPEG, PNG or WebP image');
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'photo_too_large', message: 'Photo must be 2 MB or smaller.' }, { status: 413 });
  }

  const path = `${customer.id}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await svc.storage
    .from('customer-photos')
    .upload(path, bytes, { contentType: type, upsert: false });
  if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

  const { error: setErr } = await svc.from('customers')
    .update({ photo_path: path }).eq('id', customer.id);
  if (setErr) return Response.json({ error: setErr.message }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'CUSTOMER_PHOTO_SET', detail: { customer_id: customer.id, path },
  });
  return Response.json({ photo_path: path }, { status: 201 });
}
