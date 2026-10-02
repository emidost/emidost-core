// Offline TOTP code generator, byte-exact mirror of the device's Totp.kt:
// HMAC-SHA1, counter = floor(nowMs / 30_000), big-endian 8-byte counter,
// dynamic truncation, % 100000000, padStart(8, '0'). jsSHA provides HMAC-SHA1
// in Hermes (no WebCrypto). The secret is the same base64 string the device
// stores and verifies (android.util.Base64.DEFAULT).

import jsSHA from 'jssha';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Pure-JS standard-base64 decoder (padding-tolerant, Hermes-safe). Decodes the
 * same bytes android.util.Base64.DEFAULT decodes for the server's base64
 * secrets.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/[\s=]/g, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = B64_ALPHABET.indexOf(s[i]);
    if (c === -1) continue;
    buffer = (buffer << 6) | c;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** RFC 6238 TOTP: 8 digits over a 30 s window. Mirrors Totp.kt exactly. */
export function totpCode(secretBase64: string, nowMs: number = Date.now()): string {
  const counter = Math.floor(nowMs / 30_000);
  const keyBytes = base64ToBytes(secretBase64);
  const sha = new jsSHA('SHA-1', 'UINT8ARRAY');
  sha.setHMACKey(keyBytes, 'UINT8ARRAY');
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c % 256;
    c = Math.floor(c / 256);
  }
  sha.update(msg);
  const digest = sha.getHMAC('UINT8ARRAY') as Uint8Array;
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 100_000_000).padStart(8, '0');
}

/** Seconds until the next 30 s window boundary (1..30). */
export function totpSecondsLeft(nowMs: number = Date.now()): number {
  const elapsed = ((nowMs % 30_000) + 30_000) % 30_000;
  return Math.ceil((30_000 - elapsed) / 1000);
}
