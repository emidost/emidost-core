package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.IntentFilter
import android.os.Build
import android.os.UserManager

/**
 * Kiosk + HOME takeover + protection policies. Device Owner only; every call
 * is gated on isDeviceOwnerApp and never fakes success.
 */
object LockPolicies {
  fun apply(c: Context, active: Boolean) {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(c.packageName)) return
    val admin = ComponentName(c, EmidostDeviceAdminReceiver::class.java)
    val pkg = c.packageName
    val um = c.getSystemService(Context.USER_SERVICE) as UserManager

    try { dpm.setLockTaskPackages(admin, if (active) arrayOf(pkg) else arrayOf()) } catch (_: Exception) {}

    // Call block. Emergency calls stay reachable (framework exemption), and
    // every family runs a live 112 test in the acceptance walk.
    try {
      if (active) um.setUserRestriction(admin, UserManager.DISALLOW_OUTGOING_CALLS)
      else um.clearUserRestriction(admin, UserManager.DISALLOW_OUTGOING_CALLS)
    } catch (_: Exception) {}

    // Lock-task features. GLOBAL_ACTIONS is deliberately NOT included while
    // locked: the kiosk power menu must not offer Reboot/Power off. Android
    // rejects NOTIFICATIONS without HOME, so while locked we keep only
    // KEYGUARD + SYSTEM_INFO (Wi-Fi stays reachable through the keyguard's
    // quick settings where the OEM supports it). Called explicitly because
    // Android leaves GLOBAL_ACTIONS on by default until the first call.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        dpm.setLockTaskFeatures(
          admin,
          if (active)
            (DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD or
              DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO)
          else DevicePolicyManager.LOCK_TASK_FEATURE_NONE,
        )
      } catch (_: Exception) {}
    }

    // HOME takeover: reboot lands on the lock screen; cleared on release.
    val launcher = c.packageManager.getLaunchIntentForPackage(pkg)?.component
    if (launcher != null) {
      try {
        if (active) {
          val filter = IntentFilter(android.content.Intent.ACTION_MAIN).apply {
            addCategory(android.content.Intent.CATEGORY_HOME)
            addCategory(android.content.Intent.CATEGORY_DEFAULT)
          }
          dpm.addPersistentPreferredActivity(admin, filter, launcher)
        } else {
          dpm.clearPackagePersistentPreferredActivities(admin, pkg)
        }
      } catch (_: Exception) {}
    }

    // Kiosk start when permitted (foreground Activity only).
    if (active) startKioskIfPermitted(c)
  }

  fun startKioskIfPermitted(c: Context) {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(c.packageName)) return
    if (!dpm.isLockTaskPermitted(c.packageName)) return
    try {
      val launch = c.packageManager.getLaunchIntentForPackage(c.packageName)
      launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      if (launch != null) c.startActivity(launch)
    } catch (_: Exception) {}
  }
}
