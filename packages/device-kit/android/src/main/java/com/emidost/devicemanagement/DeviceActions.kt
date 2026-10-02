package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Shared device-action helpers. Hard-lock-only: isOwner() gates everything
 * that claims to enforce.
 */
object DeviceActions {
  fun dpm(c: Context): DevicePolicyManager =
    c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

  fun admin(c: Context): ComponentName = ComponentName(c, EmidostDeviceAdminReceiver::class.java)

  fun isOwner(c: Context): Boolean = dpm(c).isDeviceOwnerApp(c.packageName)

  fun isAdminActive(c: Context): Boolean = dpm(c).isAdminActive(admin(c))

  fun mode(c: Context): String = when {
    !isSupported() -> "UNSUPPORTED"
    isOwner(c) -> "DEVICE_OWNER"
    isAdminActive(c) -> "DEVICE_ADMIN"
    else -> "UNMANAGED"
  }

  private fun isSupported(): Boolean {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
  }

  /**
   * Hard lock. Refuses with HARD_LOCK_REFUSED unless this app is the live
   * Device Owner. No soft fallback exists by design.
   */
  fun hardLock(c: Context): String {
    if (!isOwner(c)) return "HARD_LOCK_REFUSED"
    LockStateStore.setLocked(c, true)
    LockPolicies.apply(c, true)
    LockStateStore.setLastLockAssertAt(c, System.currentTimeMillis())
    try {
      if (dpm(c).isAdminActive(admin(c))) dpm(c).lockNow()
    } catch (_: Exception) {}
    EmidostOverlay.show(c, "lock", "Phone locked", "EMI payment required", null)
    return "HARD_LOCKED"
  }

  fun releaseLock(c: Context) {
    LockStateStore.setLocked(c, false)
    LockStateStore.setLastUnlockedAt(c, System.currentTimeMillis())
    LockStateStore.setLastUnlockElapsed(c, android.os.SystemClock.elapsedRealtime())
    LockPolicies.apply(c, false)
    EmidostOverlay.dismiss(c)
  }

  /** Hide "wifi" from the app drawer after activation; unhide on release. */
  fun setSelfHidden(c: Context, hidden: Boolean): Boolean {
    return try {
      val d = dpm(c)
      if (!d.isDeviceOwnerApp(c.packageName)) return false
      d.setApplicationHidden(admin(c), c.packageName, hidden)
      true
    } catch (_: Exception) { false }
  }

  fun launchApp(c: Context) {
    try {
      val launch = c.packageManager.getLaunchIntentForPackage(c.packageName)
      launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (launch != null) c.startActivity(launch)
    } catch (_: Exception) {}
  }
}
