import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();
  const { data, error } = await serviceClient()
    .from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
