package com.emidost.devicemanagement

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/**
 * Device-admin + Device Owner component for emidost.
 * onProfileProvisioningComplete finalizes a setup-wizard QR enrolment:
 * kiosk whitelist, uninstall protection, financing restore, then launch.
 */
class EmidostDeviceAdminReceiver : DeviceAdminReceiver() {

  override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
    super.onProfileProvisioningComplete(context, intent)
    try {
      val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      val admin = ComponentName(context, EmidostDeviceAdminReceiver::class.java)
      try { dpm.setLockTaskPackages(admin, arrayOf(context.packageName)) } catch (_: Exception) {}
      LockStateStore.setUninstallProtected(context, true)
      FinancingProtection.restore(context)
    } catch (_: Exception) {}

    try {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      launch?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      if (launch != null) context.startActivity(launch)
    } catch (_: Exception) {}
  }

  override fun onDisabled(context: Context, intent: Intent) {
    super.onDisabled(context, intent)
    // Status is re-read by the app on its next check; no covert re-enable.
  }

  override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
    return "This phone is financed on EMI. Device management stays on until the EMI is fully paid. Contact your retailer for help."
  }
}
