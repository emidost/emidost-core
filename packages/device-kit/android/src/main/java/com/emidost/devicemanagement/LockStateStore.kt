package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.SystemClock
import android.provider.Settings

/**
 * Persisted lock state. Lives in SharedPreferences so it survives reboot and
 * app kill; the boot receiver and command service resume enforcement from it.
 * Unlock-wins watermark: elapsedRealtime (monotonic) vs server_now.
 */
object LockStateStore {
  private const val PREFS = "emidost_lock_state"

  private fun prefs(c: Context): SharedPreferences =
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setLocked(c: Context, locked: Boolean) {
    prefs(c).edit().putBoolean("locked", locked).apply()
  }

  fun isLocked(c: Context): Boolean = prefs(c).getBoolean("locked", false)

  fun setUninstallProtected(c: Context, v: Boolean) {
    prefs(c).edit().putBoolean("uninstall_protected", v).apply()
  }

  fun isUninstallProtected(c: Context): Boolean = prefs(c).getBoolean("uninstall_protected", false)

  fun setLastUnlockedAt(c: Context, wallMillis: Long) {
    prefs(c).edit().putLong("last_unlocked_at", wallMillis).apply()
  }

  fun getLastUnlockedAt(c: Context): Long = prefs(c).getLong("last_unlocked_at", 0L)

  fun setLastUnlockElapsed(c: Context, elapsed: Long) {
    // elapsedRealtime restarts at zero on every boot, so remember which boot
    // the watermark belongs to.
    prefs(c).edit()
      .putLong("last_unlock_elapsed", elapsed)
      .putInt("last_unlock_boot", bootCount(c))
      .apply()
  }

  private fun bootCount(c: Context): Int = try {
    Settings.Global.getInt(c.contentResolver, Settings.Global.BOOT_COUNT)
  } catch (_: Exception) {
    -1
  }

  /** Current BOOT_COUNT (monotonic boot identity; -1 when unreadable). */
  fun currentBootCount(c: Context): Int = bootCount(c)

  fun getLastUnlockElapsed(c: Context): Long = prefs(c).getLong("last_unlock_elapsed", 0L)

  fun getLastUnlockBoot(c: Context): Int = prefs(c).getInt("last_unlock_boot", -1)

  fun setLastLockAssertAt(c: Context, wallMillis: Long) {
    prefs(c).edit().putLong("last_lock_assert_at", wallMillis).apply()
  }

  fun getLastLockAssertAt(c: Context): Long = prefs(c).getLong("last_lock_assert_at", 0L)

  /**
   * True when a LOCK command is older than the last unlock and must NOT run.
   * Clock-skew safe: the monotonic unlock watermark is converted to server
   * time via server_now. When the math cannot be proven (missing data), the
   * result is "stale" (unlock wins; do not re-lock).
   */
  fun isLockStale(c: Context, commandCreatedServerMs: Long, serverNowMs: Long): Boolean {
    val lastUnlockElapsed = getLastUnlockElapsed(c)
    if (lastUnlockElapsed <= 0L) return false
    if (commandCreatedServerMs <= 0L || serverNowMs <= 0L) return true
    val elapsedDelta = SystemClock.elapsedRealtime() - lastUnlockElapsed
    val unlockBoot = prefs(c).getInt("last_unlock_boot", -1)
    val sameBoot = unlockBoot != -1 && unlockBoot == bootCount(c)
    // Map the unlock to server time using the server's clock, not the device
    // wall clock (which the customer can change). A LOCK created after the
    // unlock is fresh and applies; anything older is stale and must not run.
    // After a reboot the monotonic delta is meaningless (it can go negative and
    // mark every later LOCK stale), so fall back to the wall-clock unlock time
    // corrected by the current server/device skew.
    val unlockAtServerTime = if (sameBoot && elapsedDelta >= 0) {
      serverNowMs - elapsedDelta
    } else {
      val wall = getLastUnlockedAt(c)
      if (wall <= 0L) return true
      wall + (serverNowMs - System.currentTimeMillis())
    }
    return commandCreatedServerMs <= unlockAtServerTime
  }

  fun isoToEpochMillis(iso: String): Long {
    if (iso.isEmpty()) return 0L
    val cleaned = iso.replace("Z", "+00:00")
    val match = Regex("""(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\d*([+-]\d{2}:\d{2})?""").find(cleaned)
      ?: return 0L
    val g = match.groupValues
    val year = g[1].toIntOrNull() ?: return 0L
    val month = g[2].toIntOrNull() ?: return 0L
    val day = g[3].toIntOrNull() ?: return 0L
    val hour = g[4].toIntOrNull() ?: return 0L
    val minute = g[5].toIntOrNull() ?: return 0L
    val second = g[6].toIntOrNull() ?: return 0L
    val micros = (g.getOrNull(7) ?: "").padEnd(3, '0').take(3).toIntOrNull() ?: 0
    val tz = g.getOrNull(8)
    val offsetMin = if (tz != null) {
      val sign = if (tz.startsWith("-")) -1 else 1
      val parts = tz.drop(1).split(":")
      sign * ((parts[0].toIntOrNull() ?: 0) * 60 + (parts[1].toIntOrNull() ?: 0))
    } else 0
    val base = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")).apply {
      clear()
      set(year, month - 1, day, hour, minute, second)
    }.timeInMillis
    return base + micros - offsetMin * 60_000L
  }
}
