package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Boot re-lock: financing policies, command service restart, and when the
 * persisted state says LOCKED: lockNow + cover + relaunch. HOME takeover
 * guarantees the app is what a rebooted locked phone shows.
 */
class EmidostBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON"
    ) return

    FinancingProtection.restore(context)

    if (CommandServiceStore.isConfigured(context)) {
      EmidostCommandService.start(context)
    }

    if (!LockStateStore.isLocked(context)) return
    if (!DeviceActions.isOwner(context)) return

    try {
      val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      val admin = ComponentName(context, EmidostDeviceAdminReceiver::class.java)
      if (dpm.isAdminActive(admin)) dpm.lockNow()
    } catch (_: Exception) {}

    EmidostOverlay.show(context.applicationContext, "lock", "Phone locked", "EMI payment required", null)

    try {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        context.startActivity(launch)
      }
    } catch (_: Exception) {}
  }
}
