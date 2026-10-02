import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { base64ToBytes, totpCode, totpSecondsLeft } from './totp.ts';

// RFC 6238 Appendix B secret: ASCII "12345678901234567890".
const SECRET_B64 = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTA=';

test('base64 decoder returns the same 20 bytes android Base64.DEFAULT decodes', () => {
  const bytes = base64ToBytes(SECRET_B64);
  assert.equal(bytes.length, 20);
  assert.equal(Buffer.from(bytes).toString('ascii'), '12345678901234567890');
  // Padding-less input decodes identically.
  assert.deepEqual(Array.from(base64ToBytes('MTIzNDU2Nzg5MDEyMzQ1Njc4OTA')), Array.from(bytes));
});

test('RFC 6238 SHA1 8-digit vectors', () => {
  assert.equal(totpCode(SECRET_B64, 59 * 1000), '94287082');
  assert.equal(totpCode(SECRET_B64, 1111111109 * 1000), '07081804');
  assert.equal(totpCode(SECRET_B64, 1234567890 * 1000), '89005924');
});

function nodeTotp(secretBytes, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secretBytes).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(bin % 100_000_000).padStart(8, '0');
}

test('matches node:crypto HMAC-SHA1 at sampled counters', () => {
  const key = Buffer.from(base64ToBytes(SECRET_B64));
  for (const counter of [0, 1, 123, 987654321, 2147483647]) {
    const expected = nodeTotp(key, counter);
    // Any millisecond inside the window must produce the same code.
    assert.equal(totpCode(SECRET_B64, counter * 30_000), expected);
    assert.equal(totpCode(SECRET_B64, counter * 30_000 + 15_000), expected);
  }
});

test('totpSecondsLeft boundaries', () => {
  const B = 1234567890 * 1000; // exactly on a 30 s boundary
  assert.equal(totpSecondsLeft(B), 30);
  assert.equal(totpSecondsLeft(B + 1), 30);
  assert.equal(totpSecondsLeft(B + 1000), 29);
  assert.equal(totpSecondsLeft(B + 29_999), 1);
  assert.equal(totpSecondsLeft(B + 30_000), 30);
  // Negative timestamps must not break the countdown.
  assert.equal(totpSecondsLeft(-1), 1);
});
