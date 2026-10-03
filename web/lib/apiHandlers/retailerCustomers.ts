import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff' && profile.role !== 'owner') return forbidden();
  if (profile.is_suspended) return forbidden();
  const svc = serviceClient();
  let query = svc.from('customers').select('*').order('created_at');
  if (profile.role === 'retailer_staff') query = query.eq('retailer_id', profile.retailer_id);
  // ?id= fetches one customer (detail page) instead of the whole list.
  const id = req.nextUrl.searchParams.get('id');
  if (id) query = query.eq('id', id).limit(1);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Attach a 24 h signed photo URL where a photo exists (private bucket).
  // Per-item catch: a storage hiccup yields null for that row, never an error.
  const rows = data as Array<Record<string, unknown> & { photo_path?: string | null }>;
  const withPhotos = await Promise.all(rows.map(async (row) => {
    if (!row.photo_path) return { ...row, photo_url: null };
    try {
      const { data: signed } = await svc.storage
        .from('customer-photos').createSignedUrl(row.photo_path, 86400);
      return { ...row, photo_url: signed?.signedUrl ?? null };
    } catch {
      return { ...row, photo_url: null };
    }
  }));
  return Response.json(withPhotos, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();
  if (!profile.retailer_id) return bad('No retailer bound to this account');

  const body = await req.json().catch(() => null);
  // Retailer choice at creation: "Record EMI" (tracked, overdue auto-lock
  // available) vs "No EMI record" (track_emi:false -> manual-lock only, EMI
  // fields omitted, the phone stays always-on + listening but never auto-locks).
  const trackEmi = body?.track_emi !== false;
  const required = trackEmi
    ? ['name', 'phone', 'imei', 'brand', 'model', 'emi_months', 'emi_amount', 'emi_due_day']
    : ['name', 'phone', 'imei', 'brand', 'model'];
  for (const key of required) {
    if (body?.[key] === undefined || body[key] === null || body[key] === '') return bad(`Missing ${key}`);
  }
  let emiMonths = 0;
  let emiAmount = 0;
  let dueDay = 0;
  if (trackEmi) {
    emiMonths = parseInt(body.emi_months, 10);
    emiAmount = parseFloat(body.emi_amount);
    dueDay = parseInt(body.emi_due_day, 10);
    // NaN fails every comparison, so check integers explicitly.
    if (!Number.isInteger(emiMonths) || emiMonths < 1 || emiMonths > 60) return bad('EMI months must be 1-60');
    if (!Number.isFinite(emiAmount) || !(emiAmount > 0)) return bad('EMI amount must be positive');
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return bad('Due day must be 1-31');
  }

  const svc = serviceClient();
  // Duplicate IMEI within the retailer is rejected.
  const { data: dup } = await svc.from('customers')
    .select('id').eq('retailer_id', profile.retailer_id).eq('imei', String(body.imei)).maybeSingle();
  if (dup) return Response.json({ error: 'This IMEI is already registered by you' }, { status: 409 });

  const code = 'EMD-' + randomBytes(3).toString('hex').toUpperCase();
  const lockMode = body.lock_mode === 'notify_only' ? 'notify_only' : 'lock';
  const { data, error } = await svc.from('customers').insert({
    retailer_id: profile.retailer_id,
    name: String(body.name), phone: String(body.phone), imei: String(body.imei),
    brand: String(body.brand), model: String(body.model),
    emi_months: trackEmi ? emiMonths : null,
    emi_amount: trackEmi ? emiAmount : null,
    emi_due_day: trackEmi ? dueDay : null,
    customer_code: code,
    lock_mode: lockMode,
    auto_lock_on_overdue: trackEmi,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: profile.retailer_id,
    event: 'CUSTOMER_CREATED', detail: { customer_id: data.id, brand: data.brand, model: data.model },
  });

  // No EMI record: no schedule, manual-lock only.
  if (!trackEmi) return Response.json(data, { status: 201 });

  // Generate the full repayment schedule atomically with the customer. Due
  // dates are calendar days in Asia/Calcutta (IST, UTC+05:30): the business
  // runs on Indian dates, so compute them in IST instead of the server's
  // timezone (Vercel runs UTC and would shift the due day by up to a day).
  const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const rows: { customer_id: string; retailer_id: string; due_date: string; amount_due: number; status: string }[] = [];
  for (let i = 1; i <= emiMonths; i += 1) {
    const total = m + i;
    const yy = y + Math.floor(total / 12);
    const mm = total % 12;
    const lastDay = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const dd = Math.min(dueDayOfMonth(dueDay), lastDay);
    rows.push({
      customer_id: data.id, retailer_id: profile.retailer_id as string,
      due_date: `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`,
      amount_due: emiAmount, status: 'PENDING',
    });
  }
  const { error: schedErr } = await svc.from('emi_schedules').insert(rows);
  if (schedErr) {
    await svc.from('customers').delete().eq('id', data.id);
    return Response.json({ error: schedErr.message ?? 'schedule insert failed' }, { status: 500 });
  }

  return Response.json(data, { status: 201 });
}

function dueDayOfMonth(day: number): number {
  return Math.min(Math.max(day, 1), 31);
}
