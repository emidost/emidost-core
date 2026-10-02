// Unlock-wins staleness check, shared by the customer app's JS layer.
// Mirrors the native LockStateStore.isLockStale semantics: a LOCK command
// created before the last unlock (converted to server time via server_now
// and the monotonic watermark) is stale and must not run.

export function isoToEpochMillis(iso: string): number {
  if (!iso) return 0;
  const cleaned = iso.replace('Z', '+00:00');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\d*(?:[+-]\d{2}:\d{2})?$/.exec(cleaned);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s, frac = ''] = m;
  const ms = Date.parse(
    `${y}-${mo}-${d}T${h}:${mi}:${s}.${frac.padEnd(3, '0').slice(0, 3)}Z`,
  );
  return Number.isFinite(ms) ? ms : 0;
}

export interface StaleInput {
  commandCreatedServerMs: number;
  serverNowMs: number;
  lastUnlockWallMs: number;
  lastUnlockElapsedMs: number;
  nowElapsedMs: number;
}

/**
 * True when the command is stale (do NOT lock). Missing data fails toward
 * "stale" (unlock always wins) except when no unlock watermark exists at all.
 */
export function isLockCommandStale(input: StaleInput): boolean {
  const { commandCreatedServerMs, serverNowMs, lastUnlockWallMs, lastUnlockElapsedMs, nowElapsedMs } = input;
  if (lastUnlockElapsedMs <= 0 || lastUnlockWallMs <= 0) return false;
  if (commandCreatedServerMs <= 0 || serverNowMs <= 0) return true;
  const unlockAtServerTime = lastUnlockWallMs + (nowElapsedMs - lastUnlockElapsedMs);
  return commandCreatedServerMs <= unlockAtServerTime;
}
