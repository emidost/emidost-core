import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';
import { decryptTotpSecret } from '@/lib/totpCrypto';

export const dynamic = 'force-dynamic';

/**
 * Retailer fetches the device's offline-unlock TOTP secret (Google
 * Authenticator style). The response carries the SAME base64 secret the
 * device stores and verifies locally (delivered there via the heartbeat), so
 * codes generated on the retailer's phone match codes the locked phone
 * accepts. The retailer app caches this once and generates 8-digit codes
 * offline from then on.
 *
 * A missing secret is 409, never a fresh mint: a secret minted here could
 * never reach a phone that is already offline.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'retailer_staff') return forbidden();
  if (profile.is_suspended) return forbidden();

  const svc = serviceClient();
  const { data: device } = await svc.from('devices')
    .select('id, retailer_id').eq('id', params.id).maybeSingle();
  if (!device || device.retailer_id !== profile.retailer_id) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const { data: row } = await svc.from('totp_secrets')
    .select('secret_enc').eq('device_id', params.id).maybeSingle();
  if (!row?.secret_enc) {
    return Response.json({
      error: 'no_unlock_key',
      message: 'The phone has no unlock key yet. It must complete one online sync before offline unlock works.',
    }, { status: 409 });
  }

  const secret = decryptTotpSecret(row.secret_enc);
  if (!secret) {
    return Response.json({ error: 'secret unreadable' }, { status: 500 });
  }

  await svc.from('audit_log').insert({
    actor_id: profile.id, event: 'TOTP_KEY_ISSUED_RETAILER', detail: { device_id: params.id },
  });
  return Response.json({ secret, period: 30, digits: 8 });
}
