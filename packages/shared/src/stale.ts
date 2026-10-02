// Unlock-wins staleness check, shared by the customer app's JS layer.
// Mirrors the native LockStateStore.isLockStale semantics exactly: the unlock
// watermark is mapped to SERVER time via server_now and the monotonic
// elapsedRealtime delta, so a changed device wall clock cannot void a fresh
// LOCK or resurrect a stale one. After a reboot the monotonic delta is
// meaningless (it restarts at zero), so the wall-clock unlock time corrected
// by the current server/device skew is the fallback, same as the native store.

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
  /** Device wall-clock time when the last unlock happened (reboot fallback). */
  lastUnlockWallMs: number;
  /** elapsedRealtime at the last unlock; 0 = never unlocked. */
  lastUnlockElapsedMs: number;
  /** elapsedRealtime now. */
  nowElapsedMs: number;
  /** BOOT_COUNT at the last unlock; -1 when unknown. */
  unlockBoot: number;
  /** BOOT_COUNT now; -1 when unknown. */
  nowBoot: number;
  /** Device wall-clock time now (used only in the post-reboot fallback). */
  nowWallMs: number;
}

/**
 * True when the command is stale (do NOT lock). Missing data fails toward
 * "stale" (unlock always wins) except when no unlock watermark exists at all.
 */
export function isLockCommandStale(input: StaleInput): boolean {
  const {
    commandCreatedServerMs, serverNowMs, lastUnlockWallMs, lastUnlockElapsedMs,
    nowElapsedMs, unlockBoot, nowBoot, nowWallMs,
  } = input;
  if (lastUnlockElapsedMs <= 0) return false;
  if (commandCreatedServerMs <= 0 || serverNowMs <= 0) return true;
  const elapsedDelta = nowElapsedMs - lastUnlockElapsedMs;
  const sameBoot = unlockBoot !== -1 && unlockBoot === nowBoot;
  // Map the unlock to server time using the server's clock, not the device
  // wall clock (which the customer can change). After a reboot the monotonic
  // delta can go negative and mark every later LOCK stale, so fall back to
  // the wall-clock unlock time corrected by the current skew.
  let unlockAtServerTime: number;
  if (sameBoot && elapsedDelta >= 0) {
    unlockAtServerTime = serverNowMs - elapsedDelta;
  } else {
    if (lastUnlockWallMs <= 0) return true;
    unlockAtServerTime = lastUnlockWallMs + (serverNowMs - nowWallMs);
  }
  return commandCreatedServerMs <= unlockAtServerTime;
}
