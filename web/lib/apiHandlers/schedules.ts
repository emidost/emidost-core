import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
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
  const { data, error } = await svc.from('emi_schedules')
    .select('*').eq('customer_id', params.id).order('due_date');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
