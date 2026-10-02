import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const PAYMENT_MODES = ['cash', 'upi', 'bank', 'card', 'credit'];

function invoiceNo(): string {
  const d = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
  return `EMD-INV-${d}-${randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Owner records a sale of locks/credits to a retailer. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();

  const body = await req.json().catch(() => ({}));
  const units = parseInt(body.units, 10);
  const unitPrice = parseFloat(body.unit_price);
  const creditsGranted = body.credits_granted === undefined || body.credits_granted === null
    ? 0 : parseInt(body.credits_granted, 10);
  const amountPaid = body.amount_paid === undefined || body.amount_paid === null
    ? 0 : parseFloat(body.amount_paid);
  if (!Number.isInteger(units) || units < 1 || units > 100000) return bad('Units must be a whole number between 1 and 100000');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return bad('Unit price must be zero or more');
  if (!Number.isInteger(creditsGranted) || creditsGranted < 0) return bad('Device credits must be a non-negative whole number');
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return bad('Amount paid must be zero or more');
  const total = Math.round(units * unitPrice * 100) / 100;
  if (amountPaid > total) return bad('Amount paid cannot exceed the total');
  const mode = typeof body.payment_mode === 'string' && PAYMENT_MODES.includes(body.payment_mode)
    ? body.payment_mode : 'cash';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;

  const svc = serviceClient();
  const { data: retailer } = await svc.from('retailers')
    .select('id, credits_balance, lock_allowances').eq('id', params.id).maybeSingle();
  if (!retailer) return Response.json({ error: 'not found' }, { status: 404 });

  // Compensating sequence: sale row first, then the grants, then the ledger.
  const { data: sale, error: saleErr } = await svc.from('retailer_sales').insert({
    retailer_id: retailer.id,
    owner_id: profile.id,
    units,
    unit_price: unitPrice,
    total_amount: total,
    amount_paid: amountPaid,
    credits_granted: creditsGranted,
    payment_mode: mode,
    note,
    invoice_no: invoiceNo(),
  }).select().single();
  if (saleErr || !sale) return Response.json({ error: saleErr?.message ?? 'sale insert failed' }, { status: 500 });

  const rollback = async (reason: string): Promise<Response> => {
    // Best-effort reversal, logged: credits back down (guarded by adjust_credits
    // non-negativity) and allowances back down (guarded by sub_lock_allowances).
    if (creditsGranted > 0) {
      await svc.rpc('adjust_credits', { rid: retailer.id, d: -creditsGranted })
        .then(() => {}, () => {});
    }
    await svc.rpc('sub_lock_allowances', { rid: retailer.id, n: units })
      .then(() => {}, () => {});
    await svc.from('retailer_sales').delete().eq('id', sale.id).then(() => {}, () => {});
    console.error(`[sales] rolled back sale ${sale.id}: ${reason}`);
    return Response.json({ error: reason }, { status: 500 });
  };

  if (creditsGranted > 0) {
    const { data: creditsAfter } = await svc.rpc('adjust_credits', { rid: retailer.id, d: creditsGranted });
    if (creditsAfter === null || creditsAfter === undefined) {
      return rollback('device credits grant failed');
    }
  }
  const { data: allowancesAfter } = await svc.rpc('add_lock_allowances', { rid: retailer.id, n: units });
  if (allowancesAfter === null || allowancesAfter === undefined) {
    return rollback('lock allowance grant failed');
  }

  // Ledger rows (kind 'sale', sale_id set): one for the credit grant, one for
  // the allowance grant. A failed ledger write rolls the sale back.
  if (creditsGranted > 0) {
    const { data: creditsNow } = await svc.from('retailers')
      .select('credits_balance').eq('id', retailer.id).single();
    const { error: ledgerErr } = await svc.from('credit_ledger').insert({
      retailer_id: retailer.id, kind: 'sale', delta: creditsGranted,
      balance_after: Number(creditsNow?.credits_balance ?? retailer.credits_balance),
      sale_id: sale.id, by_profile: profile.id,
    });
    if (ledgerErr) return rollback('credit ledger write failed');
  }
  const { error: allowanceLedgerErr } = await svc.from('credit_ledger').insert({
    retailer_id: retailer.id, kind: 'sale', delta: units,
    balance_after: Number(allowancesAfter), sale_id: sale.id, by_profile: profile.id,
  });
  if (allowanceLedgerErr) return rollback('allowance ledger write failed');

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: retailer.id, event: 'SALE_RECORDED',
    detail: {
      sale_id: sale.id, invoice_no: sale.invoice_no, units, unit_price: unitPrice,
      total, amount_paid: amountPaid, credits_granted: creditsGranted, payment_mode: mode,
    },
  });
  return Response.json(sale, { status: 201 });
}

/** Owner list of sales, optionally scoped to one retailer. */
export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();

  const svc = serviceClient();
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10) || 100, 1), 500);
  let query = svc.from('retailer_sales')
    .select('*, retailers(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  const rid = req.nextUrl.searchParams.get('retailer_id');
  if (rid) query = query.eq('retailer_id', rid);
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Owner sales totals + per-retailer breakdown (JS aggregation; sales volumes are small). */
export async function summaryGET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();

  const svc = serviceClient();
  const { data, error } = await svc.from('retailer_sales')
    .select('retailer_id, units, total_amount, amount_paid, created_at, retailers(name)')
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as Array<{
    retailer_id: string; units: number; total_amount: number; amount_paid: number;
    created_at: string; retailers: { name: string }[] | null;
  }>;
  let unitsSold = 0;
  let revenueTotal = 0;
  let collected = 0;
  const per = new Map<string, {
    retailer_id: string; name: string; units: number; total: number; paid: number;
    last_sale_at: string;
  }>();
  for (const r of rows) {
    unitsSold += r.units;
    revenueTotal += Number(r.total_amount);
    collected += Number(r.amount_paid);
    const entry = per.get(r.retailer_id) ?? {
      retailer_id: r.retailer_id, name: r.retailers?.[0]?.name ?? 'Unknown', units: 0,
      total: 0, paid: 0, last_sale_at: r.created_at,
    };
    entry.units += r.units;
    entry.total += Number(r.total_amount);
    entry.paid += Number(r.amount_paid);
    per.set(r.retailer_id, entry);
  }
  const per_retailer = Array.from(per.values())
    .map((e) => ({ ...e, balance: Math.round((e.total - e.paid) * 100) / 100 }))
    .sort((a, b) => b.total - a.total);

  return Response.json({
    sales_count: rows.length,
    units_sold: unitsSold,
    revenue_total: Math.round(revenueTotal * 100) / 100,
    collected: Math.round(collected * 100) / 100,
    outstanding: Math.round((revenueTotal - collected) * 100) / 100,
    per_retailer,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
