import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLockCommandStale, isoToEpochMillis } from './stale.ts';

const BASE = Date.parse('2026-10-02T12:00:00.000Z');
const H = 3600_000;

test('iso parser truncates microseconds to millis', () => {
  assert.equal(isoToEpochMillis('2026-10-02T12:00:00.123456Z'), Date.parse('2026-10-02T12:00:00.123Z'));
  assert.equal(isoToEpochMillis('2026-10-02T12:00:00Z'), Date.parse('2026-10-02T12:00:00Z'));
  assert.equal(isoToEpochMillis(''), 0);
  assert.equal(isoToEpochMillis('garbage'), 0);
});

test('no unlock watermark means a LOCK is never stale', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE, serverNowMs: BASE + 1000,
    lastUnlockWallMs: 0, lastUnlockElapsedMs: 0, nowElapsedMs: 1000,
    unlockBoot: -1, nowBoot: -1, nowWallMs: BASE,
  }), false);
});

test('LOCK older than the last unlock is stale (unlock wins)', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE - 5000, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 1000, lastUnlockElapsedMs: 5000, nowElapsedMs: 6000,
    unlockBoot: 1, nowBoot: 1, nowWallMs: BASE,
  }), true);
});

test('LOCK after the last unlock is fresh', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE + 5000, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 1000, lastUnlockElapsedMs: 5000, nowElapsedMs: 6000,
    unlockBoot: 1, nowBoot: 1, nowWallMs: BASE,
  }), false);
});

test('clock skew on the device cannot void a fresh lock', () => {
  // Device clock moved back 2 hours; the server_now math is immune to it.
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 2 * H, lastUnlockElapsedMs: 60_000, nowElapsedMs: 60_500,
    unlockBoot: 1, nowBoot: 1, nowWallMs: BASE - 2 * H,
  }), false);
});

test('unverifiable times fail toward stale (do not re-lock)', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: 0, serverNowMs: 0,
    lastUnlockWallMs: BASE, lastUnlockElapsedMs: 1000, nowElapsedMs: 2000,
    unlockBoot: -1, nowBoot: -1, nowWallMs: BASE,
  }), true);
});

test('device wall clock ahead at unlock cannot void a fresh lock (server_now math)', () => {
  // The device wall clock was 2 hours AHEAD when the unlock watermark was
  // captured. The wall-based formula would call a fresh LOCK stale for two
  // hours; the server_now-based math stays correct.
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE - 30_000, serverNowMs: BASE,
    lastUnlockWallMs: BASE + 2 * H, lastUnlockElapsedMs: 60_000, nowElapsedMs: 120_000,
    unlockBoot: 1, nowBoot: 1, nowWallMs: BASE + 2 * H,
  }), false);
});

test('after a reboot the wall-clock fallback still refuses a pre-unlock LOCK', () => {
  // elapsedRealtime restarted at zero; the same-boot math is unusable, so the
  // wall unlock time corrected by the current skew is the fallback.
  const input = {
    serverNowMs: BASE,
    lastUnlockWallMs: BASE - 10_000, lastUnlockElapsedMs: 5000, nowElapsedMs: 200,
    unlockBoot: 1, nowBoot: 2, nowWallMs: BASE,
  };
  assert.equal(isLockCommandStale({ ...input, commandCreatedServerMs: BASE - 20_000 }), true);
  assert.equal(isLockCommandStale({ ...input, commandCreatedServerMs: BASE - 5000 }), false);
});

test('after a reboot with no wall-clock unlock time, missing data fails toward stale', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE, serverNowMs: BASE,
    lastUnlockWallMs: 0, lastUnlockElapsedMs: 5000, nowElapsedMs: 200,
    unlockBoot: 1, nowBoot: 2, nowWallMs: BASE,
  }), true);
});
