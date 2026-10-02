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
  const query = serviceClient().from('customers').select('*').order('created_at');
  if (profile.role === 'retailer_staff') query.eq('retailer_id', profile.retailer_id);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();
  if (!profile.retailer_id) return bad('No retailer bound to this account');

  const body = await req.json().catch(() => null);
  const required = ['name', 'phone', 'imei', 'brand', 'model', 'emi_months', 'emi_amount', 'emi_due_day'];
  for (const key of required) {
    if (body?.[key] === undefined || body[key] === null || body[key] === '') return bad(`Missing ${key}`);
  }
  const emiMonths = parseInt(body.emi_months, 10);
  const emiAmount = parseFloat(body.emi_amount);
  const dueDay = parseInt(body.emi_due_day, 10);
  if (emiMonths < 1) return bad('EMI months must be at least 1');
  if (!(emiAmount > 0)) return bad('EMI amount must be positive');
  if (dueDay < 1 || dueDay > 31) return bad('Due day must be 1-31');

  const svc = serviceClient();
  // Duplicate IMEI within the retailer is rejected.
  const { data: dup } = await svc.from('customers')
    .select('id').eq('retailer_id', profile.retailer_id).eq('imei', String(body.imei)).maybeSingle();
  if (dup) return Response.json({ error: 'This IMEI is already registered by you' }, { status: 409 });

  const code = 'EMD-' + randomBytes(3).toString('hex').toUpperCase();
  const { data, error } = await svc.from('customers').insert({
    retailer_id: profile.retailer_id,
    name: String(body.name), phone: String(body.phone), imei: String(body.imei),
    brand: String(body.brand), model: String(body.model),
    emi_months: emiMonths, emi_amount: emiAmount, emi_due_day: dueDay,
    customer_code: code,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'insert failed' }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: profile.retailer_id,
    event: 'CUSTOMER_CREATED', detail: { customer_id: data.id, brand: data.brand, model: data.model },
  });

  // Generate the full repayment schedule atomically with the customer.
  const safeDueDay = dueDayOfMonth(dueDay);
  const now = new Date();
  const rows: { customer_id: string; retailer_id: string; due_date: string; amount_due: number; status: string }[] = [];
  for (let i = 1; i <= emiMonths; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    d.setDate(Math.min(safeDueDay, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    rows.push({
      customer_id: data.id, retailer_id: profile.retailer_id as string,
      due_date: d.toISOString().slice(0, 10), amount_due: emiAmount, status: 'PENDING',
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
