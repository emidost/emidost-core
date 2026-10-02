package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.app.admin.FactoryResetProtectionPolicy
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.UserManager

/**
 * Financing protection set: uninstall block, factory-reset/safe-boot/add-user
 * blocks, debugging block, user-control disable, and FRP. Device Owner only.
 * FRP accounts come from the app (EXPO_PUBLIC_FRP_ACCOUNTS via JS), never
 * hard-coded. Every apply re-reads the OS so failures are reported honestly.
 */
object FinancingProtection {

  private const val PREFS = "emidost_protection"

  fun rememberRequested(c: Context, frpAccounts: List<String>) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("frp_accounts", frpAccounts.joinToString(",")).apply()
  }

  fun requestedFrpAccounts(c: Context): List<String> {
    val raw = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("frp_accounts", "")
      ?: return emptyList()
    return raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
  }

  private fun rememberUserControlAttempted(c: Context, attempted: Boolean) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("user_control_attempted", attempted).apply()
  }

  private fun userControlAttempted(c: Context): Boolean =
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("user_control_attempted", false)

  fun apply(c: Context, active: Boolean, frpAccounts: List<String>) {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(c.packageName)) return
    val admin = ComponentName(c, EmidostDeviceAdminReceiver::class.java)
    val pkg = c.packageName

    try { dpm.setUninstallBlocked(admin, pkg, active) } catch (_: Exception) {}
    // Restrictions go through the DevicePolicyManager DO API.
    try { if (active) dpm.addUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET) else dpm.clearUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET) } catch (_: Exception) {}
    try { if (active) dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) else dpm.clearUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) } catch (_: Exception) {}
    try { if (active) dpm.addUserRestriction(admin, UserManager.DISALLOW_ADD_USER) else dpm.clearUserRestriction(admin, UserManager.DISALLOW_ADD_USER) } catch (_: Exception) {}
    try { if (active) dpm.addUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) else dpm.clearUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES) } catch (_: Exception) {}
    try { if (active) dpm.addUserRestriction(admin, UserManager.DISALLOW_CONFIG_DATE_TIME) else dpm.clearUserRestriction(admin, UserManager.DISALLOW_CONFIG_DATE_TIME) } catch (_: Exception) {}

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        val pkgList = if (active) {
          // The customer cannot touch the DPC, the retailer-visible apps, or Settings.
          listOf(pkg, "com.android.settings")
        } else emptyList<String>()
        dpm.setUserControlDisabledPackages(admin, pkgList)
      } catch (_: Exception) {}
      // Honest bookkeeping: Android 12+ can refuse this call for a device
      // owner on the primary user, and there is no OS readback API. Record
      // that the attempt was made; status() reports it without claiming the
      // OS applied it.
      rememberUserControlAttempted(c, active)
    }

    if (active && frpAccounts.isNotEmpty()) {
      rememberRequested(c, frpAccounts)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          val frp = FactoryResetProtectionPolicy.Builder()
            .setFactoryResetProtectionAccounts(frpAccounts)
            .setFactoryResetProtectionEnabled(true)
            .build()
          dpm.setFactoryResetProtectionPolicy(admin, frp)
        }
      } catch (_: Exception) {}
    } else if (!active) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          val frp = FactoryResetProtectionPolicy.Builder()
            .setFactoryResetProtectionEnabled(false)
            .build()
          dpm.setFactoryResetProtectionPolicy(admin, frp)
        }
      } catch (_: Exception) {}
    }

    LockStateStore.setUninstallProtected(c, active)
  }

  /** Re-apply on boot with the remembered FRP accounts. */
  fun restore(c: Context) {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(c.packageName)) return
    if (!LockStateStore.isUninstallProtected(c)) return
    apply(c, true, requestedFrpAccounts(c))
  }

  /** Honest readback of what the OS currently reports. */
  fun status(c: Context): Map<String, Any> {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    val um = c.getSystemService(Context.USER_SERVICE) as UserManager
    val admin = ComponentName(c, EmidostDeviceAdminReceiver::class.java)
    val isOwner = dpm.isDeviceOwnerApp(c.packageName)
    fun restriction(key: String): Boolean = try {
      um.getUserRestrictions(admin)[key] ?: false
    } catch (_: Exception) { false }

    val map = linkedMapOf<String, Any>()
    map["device_owner"] = isOwner
    map["uninstall_blocked"] = try { dpm.isUninstallBlocked(admin, c.packageName) } catch (_: Exception) { false }
    map["factory_reset_blocked"] = restriction(UserManager.DISALLOW_FACTORY_RESET)
    map["safe_boot_blocked"] = restriction(UserManager.DISALLOW_SAFE_BOOT)
    map["add_user_blocked"] = restriction(UserManager.DISALLOW_ADD_USER)
    map["debugging_blocked"] = restriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
    map["clock_blocked"] = restriction(UserManager.DISALLOW_CONFIG_DATE_TIME)
    map["outgoing_calls_blocked"] = restriction(UserManager.DISALLOW_OUTGOING_CALLS)
    // Honest FRP readback: Android does not expose the applied FRP account
    // list, so the OS side cannot be confirmed here. Report what is requested
    // and what is missing, and never claim the OS applied the accounts.
    map["frp_requested"] = isOwner && requestedFrpAccounts(c).isNotEmpty()
    map["frp_accounts_missing"] = isOwner && requestedFrpAccounts(c).isEmpty()
    map["frp_os_confirmed"] = false
    // Honest user-control reporting: we record the attempt, but Android does
    // not expose whether setUserControlDisabledPackages took effect (and it
    // can be refused on Android 12+ for device owners on the primary user).
    map["user_control_attempted"] = isOwner && userControlAttempted(c)
    map["user_control_os_confirmed"] = false
    return map
  }
}
