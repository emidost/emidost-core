import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();
  // Explicit columns: pin_verify and device_token_hash must not reach retailers.
  const { data, error } = await serviceClient()
    .from('devices')
    .select('id, customer_id, retailer_id, installation_id, manufacturer, model, os_version, mode, is_locked, hidden_state, last_heartbeat_at, last_location, last_location_at, created_at')
    .eq('retailer_id', profile.retailer_id).order('created_at');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
