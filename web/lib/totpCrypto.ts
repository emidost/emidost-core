import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * TOTP secret encryption at rest: AES-256-GCM. The key derives from
 * TOTP_ENC_KEY when set, otherwise from the service-role key, so the column
 * never stores a raw secret. The heartbeat decrypts server-side and delivers
 * over TLS; the device keeps the plaintext locally (documented).
 */
function key(): Buffer {
  const material = process.env.TOTP_ENC_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!material) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOTP_ENC_KEY or SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    return createHash('sha256').update('dev-key').digest();
  }
  return createHash('sha256').update(material).digest();
}

export function encryptTotpSecret(secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(secret), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  });
}

export function decryptTotpSecret(enc: string): string | null {
  try {
    const p = JSON.parse(enc) as { v: number; iv: string; tag: string; ct: string };
    if (p.v !== 1) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(p.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(p.tag, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(p.ct, 'base64')),
      decipher.final(),
    ]);
    return pt.toString('base64');
  } catch {
    return null;
  }
}
