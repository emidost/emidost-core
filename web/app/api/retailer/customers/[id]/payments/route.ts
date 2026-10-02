import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) return Response.json({ error: 'not found' }, { status: 404 });
  const { data, error } = await svc.from('payments')
    .select('*').eq('customer_id', params.id).order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const body = await req.json().catch(() => ({}));
  const amount = parseFloat(body.amount);
  if (!(amount > 0)) return bad('Amount must be positive');

  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id, status').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) return bad('Customer not found');

  const { data, error } = await svc.from('payments').insert({
    customer_id: customer.id, retailer_id: customer.retailer_id,
    amount, method: body.method ?? 'cash',
    receipt_no: body.receipt_no ?? null, recorded_by: profile.id,
  }).select().single();
  if (error || !data) return Response.json({ error: error?.message ?? 'payment insert failed' }, { status: 500 });

  // Settle the oldest unpaid schedule rows up to the paid amount (DB-truth basis).
  const { data: schedules } = await svc.from('emi_schedules')
    .select('*').eq('customer_id', customer.id).in('status', ['PENDING', 'OVERDUE', 'PARTIAL'])
    .order('due_date');
  let remaining = amount;
  for (const s of schedules ?? []) {
    if (remaining <= 0) break;
    const need = Number(s.amount_due);
    if (remaining >= need) {
      await svc.from('emi_schedules').update({ status: 'PAID' }).eq('id', s.id);
      remaining -= need;
    } else {
      await svc.from('emi_schedules').update({ status: 'PARTIAL' }).eq('id', s.id);
      remaining = 0;
    }
  }

  // Everything paid → the loan completes; the release command is the owner's call.
  const { data: left } = await svc.from('emi_schedules')
    .select('id').eq('customer_id', customer.id).in('status', ['PENDING', 'PARTIAL', 'OVERDUE']);
  if ((left ?? []).length === 0) {
    await svc.from('customers').update({ status: 'COMPLETE' }).eq('id', customer.id);
    await svc.from('release_events').insert({ customer_id: customer.id, triggered_by: 'payment' });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'PAYMENT_RECORDED', detail: { customer_id: customer.id, amount, receipt_no: data.receipt_no },
  });
  return Response.json(data, { status: 201 });
}
