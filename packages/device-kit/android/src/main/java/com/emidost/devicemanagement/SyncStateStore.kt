package com.emidost.devicemanagement

import android.content.Context

/**
 * Sync state that must survive a killed app: device-protected storage so it is
 * readable from direct boot. Mirrors the JS cache for the native 5-day
 * no-internet watchdog.
 */
object SyncStateStore {
  private const val PREFS = "emidost_sync_state"
  private const val OFFLINE_LOCK_AFTER_MS = 5L * 24 * 60 * 60 * 1000

  private fun prefs(c: Context) =
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setLastSyncOk(c: Context, at: Long) = prefs(c).edit().putLong("last_sync_ok_at", at).apply()
  fun getLastSyncOk(c: Context): Long = prefs(c).getLong("last_sync_ok_at", 0L)
  fun setLockMode(c: Context, mode: String) = prefs(c).edit().putString("lock_mode", mode).apply()
  fun getLockMode(c: Context): String = prefs(c).getString("lock_mode", "lock") ?: "lock"

  /**
   * Returns true when a lock-enabled outstanding loan has had no successful
   * sync for 5 days and must hard-lock locally. notify_only plans never lock.
   */
  fun offlineLockDue(c: Context): Boolean {
    if (getLockMode(c) != "lock") return false
    if (!SimSentinelStore.loanOutstanding(c)) return false
    val last = getLastSyncOk(c)
    if (last <= 0L) return false // never synced: no information to enforce
    return System.currentTimeMillis() - last >= OFFLINE_LOCK_AFTER_MS
  }
}
