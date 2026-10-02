import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/** Owner sets the retailer's lock-allowance total. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const allowances = parseInt(body.allowances, 10);
  if (!Number.isFinite(allowances) || allowances < 0) return bad('Allowances must be a non-negative number');

  const svc = serviceClient();
  const { data, error } = await svc.from('retailers')
    .update({ lock_allowances: allowances }).eq('id', params.id).select('lock_allowances').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: params.id, event: 'ALLOWANCES_SET', detail: { allowances },
  });
  return Response.json(data);
}
