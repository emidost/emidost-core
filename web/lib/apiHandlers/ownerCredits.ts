import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/** Owner allocates credits (device slots) or adjusts them. Ledger is append-only. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const delta = parseInt(body.delta, 10);
  const kind = body.kind === 'adjust' ? 'adjust' : 'topup';
  if (!Number.isFinite(delta) || delta === 0) return bad('Delta must be a non-zero number');

  const svc = serviceClient();
  // Distinguish "no such retailer" from "would go below zero".
  const { data: retailer } = await svc.from('retailers')
    .select('id').eq('id', params.id).maybeSingle();
  if (!retailer) return Response.json({ error: 'not found' }, { status: 404 });

  // Atomic adjustment (no read-then-write race).
  const { data: balance, error } = await svc.rpc('adjust_credits', { rid: params.id, d: delta });
  if (error || balance === null || balance === undefined) {
    if (delta < 0) return bad('Credits cannot go below zero');
    return Response.json({ error: error?.message ?? 'credit adjustment failed' }, { status: 500 });
  }

  await svc.from('credit_ledger').insert({
    retailer_id: params.id, kind, delta, balance_after: Number(balance), by_profile: profile.id,
  });
  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: params.id, event: 'CREDITS_ALLOCATED', detail: { delta, balance_after: balance },
  });
  return Response.json({ credits_balance: balance });
}
