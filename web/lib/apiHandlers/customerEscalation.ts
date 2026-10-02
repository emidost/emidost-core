import { NextRequest } from 'next/server';
import { bad, forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * Portal/console kill-switch for overdue escalation. `enabled: false` stops
 * the phone's 30-min voice escalation AND the day-3+ location SMS (delivered
 * via the heartbeat); the lock behaviour itself is unchanged. Every toggle is
 * audited.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const body = await req.json().catch(() => ({}));
  if (typeof body?.enabled !== 'boolean') {
    return bad('enabled must be a boolean');
  }

  const svc = serviceClient();
  const { data: customer } = await svc.from('customers')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!customer || customer.retailer_id !== profile.retailer_id) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const { data, error } = await svc.from('customers')
    .update({ overdue_escalation_enabled: body.enabled })
    .eq('id', customer.id)
    .select('id, overdue_escalation_enabled').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await svc.from('audit_log').insert({
    actor_id: profile.id, retailer_id: customer.retailer_id,
    event: 'ESCALATION_TOGGLED',
    detail: { customer_id: customer.id, enabled: body.enabled },
  });
  return Response.json({ customer_id: customer.id, overdue_escalation_enabled: body.enabled });
}
