import { createHmac, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/** Owner issues an offline TOTP code for a device. Audited; secret stays server-side. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();

  const svc = serviceClient();
  const { data: device } = await svc.from('devices').select('id').eq('id', params.id).maybeSingle();
  if (!device) return Response.json({ error: 'not found' }, { status: 404 });

  // TOTP over HMAC-SHA1: 8 digits, 30 s window. The secret is delivered to the
  // device over the authenticated heartbeat channel (offline verify). HARDENING
  // TODO: encrypt at rest with a real key before production; the column is
  // service-role-only in the meantime.
  const secret = randomBytes(20);
  const counter = Math.floor(Date.now() / 30000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]) % 100000000;
  const value = String(code).padStart(8, '0');

  await svc.from('totp_secrets').upsert({
    device_id: params.id,
    secret_enc: secret.toString('base64'),
    counter,
  });
  await svc.from('audit_log').insert({
    actor_id: profile.id, event: 'TOTP_ISSUED', detail: { device_id: params.id },
  });
  return Response.json({ code: value, expires_in_seconds: 30 });
}
