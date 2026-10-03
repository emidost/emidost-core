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
  if (customer.status === 'COMPLETE' || customer.status === 'SETTLED') {
    return bad('This loan is settled. No further payments are needed.');
  }

  // One transaction in SQL (0010 record_payment): the payment row and the
  // oldest-first schedule settlement commit together, serialized per customer.
  // The RPC rejects overpayments ('overpayment') and settled loans.
  const receiptNo = typeof body.receipt_no === 'string' ? body.receipt_no : null;
  const { data: rows, error } = await svc.rpc('record_payment', {
    cid: customer.id, amt: amount,
    pay_method: typeof body.method === 'string' ? body.method : 'cash',
    receipt: receiptNo, recorder: profile.id,
  });
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (error || !result) {
    const message = String(error?.message ?? '');
    if (message.includes('overpayment')) {
      return bad('Overpayment: the amount exceeds the total remaining balance due.');
    }
    return Response.json({ error: error?.message ?? 'payment failed' }, { status: 500 });
  }

  // Everything paid: the loan completes, but the phone is NOT auto-released.
  // The screen unlocks (the phone stops auto-locking once loan_status=COMPLETE)
  // yet the device stays Device-Owner managed and hidden until the retailer
  // explicitly sends RELEASE, which is the ONLY path that frees the device
  // credit and unhides the app (ack.ts RELEASE branch). This is the common
  // practice the retailer asked for: payoff does not auto-free the phone.
  if (result.completed) {
    await svc.from('audit_log').insert({
      actor_id: profile.id, retailer_id: customer.retailer_id,
      event: 'LOAN_COMPLETED_PENDING_RELEASE', detail: { customer_id: customer.id },
    });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'PAYMENT_RECORDED', detail: { customer_id: customer.id, amount, receipt_no: receiptNo },
  });
  return Response.json({
    id: result.payment_id, customer_id: customer.id, amount, receipt_no: receiptNo, completed: result.completed,
  }, { status: 201 });
}
