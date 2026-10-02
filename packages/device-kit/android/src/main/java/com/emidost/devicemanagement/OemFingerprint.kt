package com.emidost.devicemanagement

import android.content.ComponentName
import android.content.Context
import android.os.Build

/**
 * OEM fingerprint engine (Kotlin). Mirrors @emidost/shared/oemMatrix.ts.
 * The UI reads the profile via getOemProfile(); this copy drives native
 * intents for autostart/battery screens.
 */
enum class OemFamily { NEAR_STOCK, SAMSUNG, XIAOMI, VIVO, OPPO, HONOR, TRANSSION, UNKNOWN }

data class OemProfile(
  val family: OemFamily,
  val displayName: String,
  val autostartIntents: List<ComponentName>,
  val popupIntents: List<ComponentName>,
  val needsAutostartGrant: Boolean,
  val needsBatteryExemption: Boolean,
  val restrictedSettingsPath: String,
  val wirelessDebugGateHint: String,
)

object OemFingerprint {
  fun detect(context: Context): OemProfile {
    val m = Build.MANUFACTURER?.lowercase() ?: ""
    val b = Build.BRAND?.lowercase() ?: ""
    val family = when {
      m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ||
        b.contains("xiaomi") || b.contains("redmi") || b.contains("poco") -> OemFamily.XIAOMI
      m.contains("vivo") || m.contains("iqoo") -> OemFamily.VIVO
      m.contains("oppo") || m.contains("realme") || m.contains("oneplus") -> OemFamily.OPPO
      m.contains("huawei") || m.contains("honor") || m.contains("hihonor") -> OemFamily.HONOR
      m.contains("samsung") -> OemFamily.SAMSUNG
      m.contains("tecno") || m.contains("infinix") || m.contains("itel") || m.contains("transsion") -> OemFamily.TRANSSION
      m.contains("motorola") || m.contains("nothing") || m.contains("cmf") ||
        m.contains("lava") || m.contains("hmd") || m.contains("nokia") ||
        m.contains("google") || m.contains("pixel") -> OemFamily.NEAR_STOCK
      else -> OemFamily.UNKNOWN
    }
    return when (family) {
      OemFamily.XIAOMI -> OemProfile(
        family, "Xiaomi / Redmi / POCO (HyperOS / MIUI)",
        listOf(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")),
        listOf(ComponentName("com.miui.securitycenter", "com.miui.permcenter.permissions.AppPermissionsEditorActivity")),
        true, true,
        "Settings → Apps → Manage apps → wifi → ⋮ → Allow restricted settings",
        "Wireless pairing needs no Mi account or SIM. Turn off MIUI Optimization and keep notification style Native.",
      )
      OemFamily.VIVO -> OemProfile(
        family, "vivo / iQOO (Funtouch OS)",
        listOf(
          ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
          ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        ),
        listOf(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity")),
        true, true,
        "Settings → Apps → App management → wifi → ⋮ → Allow restricted settings",
        "No account or SIM needed for wireless pairing.",
      )
      OemFamily.OPPO -> OemProfile(
        family, "OPPO / OnePlus / realme (ColorOS / OxygenOS)",
        listOf(
          ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
          ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
          ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
        ),
        emptyList(),
        true, true,
        "Settings → Apps → App management → wifi → ⋮ → Allow restricted settings",
        "Turn off permission monitoring in Developer options (ColorOS 15). Keep the screen on during enrolment.",
      )
      OemFamily.HONOR -> OemProfile(
        family, "HONOR (MagicOS)",
        listOf(
          ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
          ComponentName("com.hihonor.systemmanager", "com.hihonor.systemmanager.optimize.process.ProtectActivity"),
        ),
        emptyList(),
        true, true,
        "Settings → Apps → wifi → ⋮ → Allow restricted settings",
        "After activation set App launch: auto-launch + secondary launch + run in background.",
      )
      OemFamily.SAMSUNG -> OemProfile(
        family, "Samsung (One UI)",
        emptyList(), emptyList(),
        false, true,
        "Settings → Apps → wifi → ⋮ → Allow restricted settings",
        "Turn off Samsung Auto Blocker first (it blocks APK installs and device admin). Use wireless pairing, not USB.",
      )
      OemFamily.TRANSSION -> OemProfile(
        family, "TECNO / Infinix / itel (HiOS / XOS / itel OS)",
        listOf(
          ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
          ComponentName("com.transsion.phonemaster", "com.transsion.phonemaster.MainActivity"),
        ),
        emptyList(),
        true, true,
        "Settings → Apps → wifi → ⋮ → Allow restricted settings",
        "Keep \"Disable permission monitoring\" off in Phone Master.",
      )
      OemFamily.NEAR_STOCK, OemFamily.UNKNOWN -> OemProfile(
        family,
        if (family == OemFamily.UNKNOWN) "Unknown OEM" else "Pixel / Motorola / Nothing / CMF / Lava / HMD",
        emptyList(), emptyList(),
        false, false,
        "Settings → Apps → wifi → ⋮ → Allow restricted settings",
        "No account needed. Developer options via Build number 7 taps.",
      )
    }
  }
}

object OemPermissionHelper {
  fun openOemAutostartSettings(context: Context): Boolean = openFirst(context,
    OemFingerprint.detect(context).autostartIntents)

  fun openOemBackgroundPopups(context: Context): Boolean {
    val pkg = context.packageName
    val intents = OemFingerprint.detect(context).popupIntents.map { c ->
      android.content.Intent().setComponent(c).putExtra("packagename", pkg).putExtra("packageName", pkg)
    }
    return openFirst(context, intents)
  }

  private fun openFirst(context: Context, components: List<ComponentName>): Boolean {
    for (c in components) {
      val i = android.content.Intent().setComponent(c).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        if (context.packageManager.resolveActivity(i, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY) != null) {
          context.startActivity(i)
          return true
        }
      } catch (_: Exception) {}
    }
    try {
      context.startActivity(
        android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (_: Exception) {}
    return false
  }
}
