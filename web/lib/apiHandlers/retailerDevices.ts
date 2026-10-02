import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  const { data, error } = await serviceClient()
    .from('devices').select('*').eq('retailer_id', profile.retailer_id).order('created_at');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
