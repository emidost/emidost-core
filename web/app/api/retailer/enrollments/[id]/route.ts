import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff' && profile.role !== 'owner') return forbidden();
  const svc = serviceClient();
  const query = svc.from('enrollment_sessions').select('*').eq('id', params.id);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return Response.json({ error: 'not found' }, { status: 404 });
  if (profile.role === 'retailer_staff' && data.retailer_id !== profile.retailer_id) return forbidden();
  return Response.json(data);
}
