import { createHmac, randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { forbidden, requireActor, unauthorized } from '@/lib/auth';
import { serviceClient } from '@/lib/supabaseServer';
import { decryptTotpSecret, encryptTotpSecret } from '@/lib/totpCrypto';

export const dynamic = 'force-dynamic';

/**
 * Owner issues an offline TOTP code for a device. The secret is STABLE:
 * reusing the existing secret keeps codes valid for the offline device that
 * already has it. Only an explicit rotate=1 mints a fresh secret (do that
 * while the phone is online so the heartbeat can deliver the new one).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { profile } = await requireActor(req);
  if (!profile) return unauthorized();
  if (profile.role !== 'owner') return forbidden();

  const svc = serviceClient();
  const { data: device } = await svc.from('devices').select('id').eq('id', params.id).maybeSingle();
  if (!device) return Response.json({ error: 'not found' }, { status: 404 });

  const rotate = req.nextUrl.searchParams.get('rotate') === '1';
  const { data: existing } = await svc.from('totp_secrets')
    .select('secret_enc').eq('device_id', params.id).maybeSingle();
  let secret: Buffer;
  if (!rotate && existing?.secret_enc) {
    const plain = decryptTotpSecret(existing.secret_enc);
    if (!plain) return Response.json({ error: 'secret unreadable, rotate required' }, { status: 500 });
    secret = Buffer.from(plain, 'base64');
  } else {
    secret = randomBytes(20);
  }

  // TOTP over HMAC-SHA1: 8 digits, 30 s window. The secret is AES-256-GCM
  // encrypted at rest and delivered to the device over the authenticated
  // heartbeat channel (offline verify).
  const counter = Math.floor(Date.now() / 30000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]) % 100000000;
  const value = String(code).padStart(8, '0');

  await svc.from('totp_secrets').upsert({
    device_id: params.id,
    secret_enc: encryptTotpSecret(secret),
    counter,
  });
  await svc.from('audit_log').insert({
    actor_id: profile.id, event: 'TOTP_ISSUED', detail: { device_id: params.id, rotated: rotate },
  });
  return Response.json({ code: value, expires_in_seconds: 30, rotated: rotate });
}
