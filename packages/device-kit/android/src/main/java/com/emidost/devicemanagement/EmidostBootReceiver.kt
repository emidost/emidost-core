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

    // Direct-boot safe: policy state lives in device-protected storage
    // (DpcContext falls back to the plain context below API 24).
    val dpc = DpcContext.wrap(context)

    FinancingProtection.restore(dpc)

    if (CommandServiceStore.isConfigured(dpc)) {
      EmidostCommandService.start(dpc)
    }

    if (!LockStateStore.isLocked(dpc)) return
    if (!DeviceActions.isOwner(dpc)) return

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
