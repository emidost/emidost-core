package com.emidost.devicemanagement

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * Sync state that must survive a killed app: device-protected storage so it is
 * readable from direct boot. Mirrors the JS cache for the native no-internet
 * watchdogs: 5 days offline hard-locks, and (user rule) 4 days offline WHILE
 * overdue >= 1 day auto-blocks earlier. notify_only plans never lock.
 */
object SyncStateStore {
  private const val PREFS = "emidost_sync_state"
  private const val OFFLINE_LOCK_AFTER_MS = 5L * 24 * 60 * 60 * 1000
  private const val OVERDUE_OFFLINE_LOCK_AFTER_MS = 4L * 24 * 60 * 60 * 1000
  private const val IST = "Asia/Kolkata"

  private fun prefs(c: Context) =
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setLastSyncOk(c: Context, at: Long) = prefs(c).edit().putLong("last_sync_ok_at", at).apply()
  fun getLastSyncOk(c: Context): Long = prefs(c).getLong("last_sync_ok_at", 0L)
  fun setLockMode(c: Context, mode: String) = prefs(c).edit().putString("lock_mode", mode).apply()
  fun getLockMode(c: Context): String = prefs(c).getString("lock_mode", "lock") ?: "lock"

  fun setOverdueDays(c: Context, days: Int) = prefs(c).edit().putInt("overdue_days", days).apply()
  fun getOverdueDays(c: Context): Int = prefs(c).getInt("overdue_days", 0)
  fun setDueDate(c: Context, due: String) = prefs(c).edit().putString("due_date", due).apply()
  fun getDueDate(c: Context): String = prefs(c).getString("due_date", "") ?: ""

  fun setEmiAmount(c: Context, amount: String) = prefs(c).edit().putString("emi_amount", amount).apply()
  fun getEmiAmount(c: Context): String = prefs(c).getString("emi_amount", "") ?: ""

  /**
   * Retailer opt-in: true only when an EMI plan is recorded for the customer.
   * When false, ALL automatic locks are suppressed (the phone stays always-on
   * and listening but never auto-locks); manual retailer LOCK still works.
   */
  fun setAutoLockOnOverdue(c: Context, on: Boolean) = prefs(c).edit().putBoolean("auto_lock_on_overdue", on).apply()
  fun autoLockOnOverdue(c: Context): Boolean = prefs(c).getBoolean("auto_lock_on_overdue", false)

  /**
   * Returns true when a lock-enabled outstanding loan has had no successful
   * sync for 5 days and must hard-lock locally. notify_only plans never lock.
   */
  fun offlineLockDue(c: Context): Boolean {
    // Retailer-controlled: no automatic lock unless the retailer opted in.
    if (!autoLockOnOverdue(c)) return false
    if (getLockMode(c) != "lock") return false
    if (!SimSentinelStore.loanOutstanding(c)) return false
    val last = getLastSyncOk(c)
    if (last <= 0L) return false // never synced: no information to enforce
    return System.currentTimeMillis() - last >= OFFLINE_LOCK_AFTER_MS
  }

  /**
   * User rule: after 4 days with no update AND no internet, an overdue phone
   * auto-blocks. Condition: lock plan + outstanding loan + overdue >= 1 day
   * (max of the server-reported overdue_days and the locally computed days
   * since the cached due date in IST) + (now - lastSyncOk) >= 4 days.
   *
   * NOT gated on escalation_enabled: that kill-switch stops the 30-min voice
   * alerts and the day-3+ location SMS, never the lock (documented split).
   */
  fun overdueOfflineLockDue(c: Context): Boolean {
    // Retailer-controlled: no automatic lock unless the retailer opted in.
    if (!autoLockOnOverdue(c)) return false
    if (getLockMode(c) != "lock") return false
    if (!SimSentinelStore.loanOutstanding(c)) return false
    val overdue = maxOf(getOverdueDays(c), daysSinceDueDate(c))
    if (overdue < 1) return false
    val last = getLastSyncOk(c)
    if (last <= 0L) return false // never synced: no information to enforce
    return System.currentTimeMillis() - last >= OVERDUE_OFFLINE_LOCK_AFTER_MS
  }

  /** Whole days since the cached due date, computed in IST; 0 on any parse failure. */
  private fun daysSinceDueDate(c: Context): Int {
    val due = getDueDate(c)
    if (due.isEmpty()) return 0
    return try {
      val tz = TimeZone.getTimeZone(IST)
      val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
      fmt.timeZone = tz
      val dueMs = fmt.parse(due)?.time ?: return 0
      val nowCal = Calendar.getInstance(tz).apply { timeInMillis = System.currentTimeMillis() }
      val dueCal = Calendar.getInstance(tz).apply { timeInMillis = dueMs }
      val nowDay = nowCal.get(Calendar.YEAR) * 366 + nowCal.get(Calendar.DAY_OF_YEAR)
      val dueDay = dueCal.get(Calendar.YEAR) * 366 + dueCal.get(Calendar.DAY_OF_YEAR)
      maxOf(0, nowDay - dueDay)
    } catch (_: Exception) {
      0
    }
  }
}
