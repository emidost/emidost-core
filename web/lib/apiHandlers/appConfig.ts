import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

// Owner-set config the retailer app reads to build the enrolment QR.
const KEYS = ['customer_apk_url', 'customer_apk_sha256'];

/** GET /api/config/customer-apk - owner + retailer_staff read the APK link + SHA. */
export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner' && profile.role !== 'retailer_staff') return forbidden();
  const svc = serviceClient();
  const { data } = await svc.from('app_config').select('key, value').in('key', KEYS);
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[(r as { key: string }).key] = (r as { value: string | null }).value ?? '';
  return Response.json({
    customer_apk_url: out.customer_apk_url ?? '',
    customer_apk_sha256: out.customer_apk_sha256 ?? '',
  });
}

/** POST /api/config/customer-apk - owner sets the APK link and/or SHA. */
export async function POST(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const url = typeof body.customer_apk_url === 'string' ? body.customer_apk_url.trim() : null;
  const shaRaw = typeof body.customer_apk_sha256 === 'string' ? body.customer_apk_sha256.trim().toLowerCase() : null;
  if (shaRaw !== null && shaRaw !== '' && !/^[0-9a-f]{64}$/.test(shaRaw)) {
    return bad('SHA-256 must be 64 hex characters');
  }
  const now = new Date().toISOString();
  const rows: { key: string; value: string; updated_at: string; updated_by: string }[] = [];
  if (url !== null) rows.push({ key: 'customer_apk_url', value: url, updated_at: now, updated_by: profile.id });
  if (shaRaw !== null) rows.push({ key: 'customer_apk_sha256', value: shaRaw, updated_at: now, updated_by: profile.id });
  if (rows.length === 0) return bad('Nothing to update');
  const svc = serviceClient();
  const { error } = await svc.from('app_config').upsert(rows, { onConflict: 'key' });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: null,
    event: 'APP_CONFIG_SET', detail: { keys: rows.map((r) => r.key) },
  });
  return Response.json({ ok: true });
}
