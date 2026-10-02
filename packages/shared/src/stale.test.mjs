import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLockCommandStale, isoToEpochMillis } from './stale.ts';

const BASE = Date.parse('2026-10-02T12:00:00.000Z');

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
  }), false);
});

test('LOCK older than the last unlock is stale (unlock wins)', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE - 5000, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 1000, lastUnlockElapsedMs: 5000, nowElapsedMs: 6000,
  }), true);
});

test('LOCK after the last unlock is fresh', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE + 5000, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 1000, lastUnlockElapsedMs: 5000, nowElapsedMs: 6000,
  }), false);
});

test('clock skew on the device cannot void a fresh lock', () => {
  // Device clock moved back 2 hours; elapsedRealtime watermark is immune.
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: BASE, serverNowMs: BASE,
    lastUnlockWallMs: BASE - 2 * 3600_000, lastUnlockElapsedMs: 60_000, nowElapsedMs: 60_500,
  }), false);
});

test('unverifiable times fail toward stale (do not re-lock)', () => {
  assert.equal(isLockCommandStale({
    commandCreatedServerMs: 0, serverNowMs: 0,
    lastUnlockWallMs: BASE, lastUnlockElapsedMs: 1000, nowElapsedMs: 2000,
  }), true);
});
