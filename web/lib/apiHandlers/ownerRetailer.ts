import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const body = await req.json().catch(() => ({}));
  const svc = serviceClient();

  const { data: retailer, error: rErr } = await svc
    .from('retailers').select('id').eq('id', params.id).maybeSingle();
  if (rErr || !retailer) return Response.json({ error: 'not found' }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name) update.name = body.name;
  if (typeof body.phone === 'string' && body.phone) update.phone = body.phone;
  if (typeof body.is_suspended === 'boolean') update.is_suspended = body.is_suspended;

  const { data, error } = await svc.from('retailers').update(update).eq('id', params.id).select().single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Handlers and the portal gate on profiles.is_suspended, so the retailer
  // flag must reach every staff profile or suspension does nothing.
  if (typeof body.is_suspended === 'boolean') {
    const { error: pErr } = await svc.from('profiles')
      .update({ is_suspended: body.is_suspended }).eq('retailer_id', params.id);
    if (pErr) return Response.json({ error: pErr.message }, { status: 500 });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: params.id,
    event: 'RETAILER_UPDATED', detail: { changed: Object.keys(update) },
  });

  // Suspension takes effect immediately: requireActor re-checks the live
  // profile row on every request, so no further command or login passes.
  return Response.json(data);
}
