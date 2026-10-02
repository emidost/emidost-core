package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
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

  fun apply(c: Context, active: Boolean, frpAccounts: List<String>) {
    val dpm = c.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    if (!dpm.isDeviceOwnerApp(c.packageName)) return
    val admin = ComponentName(c, EmidostDeviceAdminReceiver::class.java)
    val um = c.getSystemService(Context.USER_SERVICE) as UserManager
    val pkg = c.packageName

    try { dpm.setUninstallBlocked(admin, pkg, active) } catch (_: Exception) {}
    try { um.setUserRestriction(admin, UserManager.DISALLOW_FACTORY_RESET, active) } catch (_: Exception) {}
    try { um.setUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT, active) } catch (_: Exception) {}
    try { um.setUserRestriction(admin, UserManager.DISALLOW_ADD_USER, active) } catch (_: Exception) {}
    try { um.setUserRestriction(admin, UserManager.DISALLOW_DEBUGGING_FEATURES, active) } catch (_: Exception) {}
    try { um.setUserRestriction(admin, UserManager.DISALLOW_CONFIG_DATE_TIME, active) } catch (_: Exception) {}

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        val pkgList = if (active) {
          // The customer cannot touch the DPC, the retailer-visible apps, or Settings.
          arrayOf(pkg, "com.android.settings")
        } else emptyArray()
        dpm.setUserControlDisabledPackages(admin, pkgList)
      } catch (_: Exception) {}
    }

    if (active && frpAccounts.isNotEmpty()) {
      rememberRequested(c, frpAccounts)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          dpm.setFactoryResetProtectionPolicy(admin,
            DevicePolicyManager.newFactoryResetProtectionPolicyBuilder()
              .setFactoryResetProtectionAccounts(frpAccounts)
              .setFactoryResetProtectionEnabled(true)
              .build())
        }
      } catch (_: Exception) {}
    } else if (!active) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          dpm.setFactoryResetProtectionPolicy(admin,
            DevicePolicyManager.newFactoryResetProtectionPolicyBuilder()
              .setFactoryResetProtectionEnabled(false)
              .build())
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
    return map
  }
}
