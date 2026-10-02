package com.emidost.devicemanagement

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.telephony.TelephonyManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module: the whole emidost device-management surface. Hard-lock-only:
 * executeAuthorizedLock refuses without a live Device Owner.
 */
class EmidostDeviceManagementModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "react context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("EmidostDeviceManagement")

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.M }
    Function("isDeviceOwner") { DeviceActions.isOwner(context) }
    Function("isDeviceAdminEnabled") { DeviceActions.isAdminActive(context) }
    Function("getManagementMode") { DeviceActions.mode(context) }

    Function("getDeviceManagementStatus") {
      mapOf(
        "mode" to DeviceActions.mode(context),
        "adminActive" to DeviceActions.isAdminActive(context),
        "enforcedLocked" to LockStateStore.isLocked(context),
        "hidden" to isHidden(),
        "lastLockAssertAt" to LockStateStore.getLastLockAssertAt(context),
        "kioskActive" to LockPolicies.kioskActive(context),
        // Unlock-wins watermark readback: the JS layer checks LOCK staleness
        // with the same inputs the native service uses.
        "lastUnlockedAt" to LockStateStore.getLastUnlockedAt(context),
        "lastUnlockElapsed" to LockStateStore.getLastUnlockElapsed(context),
        "lastUnlockBoot" to LockStateStore.getLastUnlockBoot(context),
        "bootCount" to LockStateStore.currentBootCount(context),
        "elapsedRealtime" to android.os.SystemClock.elapsedRealtime(),
        // Honest reporting: a SIM baseline exists only when IMSI or ICCID was
        // readable at baseline time (some devices return null — documented).
        "simBaselinePresent" to (SimSentinelStore.baselineImsi(context) != null ||
          SimSentinelStore.baselineIccid(context) != null),
      )
    }

    Function("getDeviceInfo") {
      mapOf(
        "manufacturer" to (Build.MANUFACTURER ?: ""),
        "model" to (Build.MODEL ?: ""),
        "androidVersion" to Build.VERSION.RELEASE,
        "sdkInt" to Build.VERSION.SDK_INT,
      )
    }

    Function("lockNow") {
      // Hard-lock-only: the screen lock is an enforcement step, not a feature;
      // refuse without a live Device Owner.
      if (!DeviceActions.isOwner(context)) false
      else {
        try {
          val dpm = DeviceActions.dpm(context)
          if (dpm.isAdminActive(DeviceActions.admin(context))) { dpm.lockNow(); true } else false
        } catch (_: Exception) { false }
      }
    }

    Function("enterLockTask") {
      // Pins the foreground activity into kiosk mode when permitted.
      if (!DeviceActions.isOwner(context)) false
      else {
        try {
          val activity = appContext.currentActivity
          if (activity != null && DeviceActions.dpm(context).isLockTaskPermitted(context.packageName)) {
            activity.startLockTask()
            true
          } else false
        } catch (_: Exception) { false }
      }
    }

    Function("exitLockTask") {
      // Unpins the foreground activity when the phone is unlocked again.
      // Safe to call when not pinned (the exception is caught).
      try {
        val activity = appContext.currentActivity
        if (activity != null) { activity.stopLockTask(); true } else false
      } catch (_: Exception) { false }
    }

    Function("executeAuthorizedLock") { commandId: String ->
      val result = DeviceActions.hardLock(context)
      mapOf(
        "ok" to (result == "HARD_LOCKED"),
        "commandId" to commandId,
        "mode" to DeviceActions.mode(context),
        "enforced" to (result == "HARD_LOCKED"),
        "reason" to if (result == "HARD_LOCKED") null else result,
      )
    }

    Function("executeAuthorizedUnlock") { commandId: String ->
      DeviceActions.releaseLock(context)
      mapOf("ok" to true, "commandId" to commandId)
    }

    Function("applyFinancingProtection") { active: Boolean, frpAccountsJson: String? ->
      val accounts = parseAccounts(frpAccountsJson)
      FinancingProtection.apply(context, active, accounts)
      mapOf("applied" to DeviceActions.isOwner(context), "status" to FinancingProtection.status(context))
    }

    Function("getProtectionStatus") { FinancingProtection.status(context) }

    Function("setUninstallProtection") { active: Boolean ->
      if (!DeviceActions.isOwner(context)) mapOf("applied" to false, "reason" to "requires_device_owner")
      else {
        try {
          val dpm = DeviceActions.dpm(context)
          dpm.setUninstallBlocked(DeviceActions.admin(context), context.packageName, active)
          mapOf("applied" to true)
        } catch (_: Exception) { mapOf("applied" to false, "reason" to "security_exception") }
      }
    }

    Function("getOemProfile") {
      val p = OemFingerprint.detect(context)
      mapOf(
        "family" to p.family.name,
        "displayName" to p.displayName,
        "needsAutostartGrant" to p.needsAutostartGrant,
        "needsBatteryExemption" to p.needsBatteryExemption,
        "restrictedSettingsPath" to p.restrictedSettingsPath,
        "wirelessDebugGateHint" to p.wirelessDebugGateHint,
      )
    }

    Function("openOemAutostartSettings") { mapOf("opened" to OemPermissionHelper.openOemAutostartSettings(context)) }
    Function("openOemBackgroundPopups") { mapOf("opened" to OemPermissionHelper.openOemBackgroundPopups(context)) }

    Function("configureCommandService") { baseUrl: String, installationId: String, deviceToken: String ->
      CommandServiceStore.configure(context, baseUrl, installationId, deviceToken)
      true
    }
    Function("startCommandService") { EmidostCommandService.start(context); true }
    Function("stopCommandService") { try { context.stopService(Intent(context, EmidostCommandService::class.java)) } catch (_: Exception) {}; true }
    Function("isCommandServiceRunning") { EmidostCommandService.running }

    Function("configureSmsControl") { sendersCsv: String, customerCode: String ->
      SmsCommandStore.configure(context, sendersCsv, customerCode)
      true
    }

    Function("setSimBaseline") { imsi: String?, iccid: String? ->
      SimSentinelStore.setBaseline(context, imsi ?: "", iccid ?: "")
      true
    }
    Function("setLoanOutstanding") { outstanding: Boolean ->
      SimSentinelStore.setLoanOutstanding(context, outstanding)
      true
    }

    Function("hideSelf") {
      val ok = DeviceActions.setSelfHidden(context, true)
      mapOf("hidden" to (ok || isHidden()))
    }
    Function("unhideSelf") {
      val ok = DeviceActions.setSelfHidden(context, false)
      mapOf("hidden" to (!ok && isHidden()))
    }
    Function("getHiddenState") { isHidden() }

    Function("setPinVerify") { hash: String ->
      DevicePinStore.setVerifyHash(context, hash)
      true
    }
    // Offline watchdog mirror: the JS sync loop records its successful sync
    // and the plan mode natively, so enforcement survives a killed app.
    Function("markSyncOkNative") {
      SyncStateStore.setLastSyncOk(context, System.currentTimeMillis())
      true
    }
    Function("setLockModeNative") { mode: String ->
      SyncStateStore.setLockMode(context, if (mode == "notify_only") "notify_only" else "lock")
      true
    }
    Function("verifyDevicePin") { pin: String -> DevicePinStore.verify(context, pin) }
    Function("hasDevicePin") { DevicePinStore.hasPin(context) }

    Function("showLockOverlay") { title: String, body: String ->
      EmidostOverlay.show(context, "lock", title, body, null)
      mapOf("shown" to true)
    }
    Function("showCallOverlay") { title: String, body: String, phone: String ->
      EmidostOverlay.show(context, "call", title, body, phone)
      mapOf("shown" to true)
    }
    Function("showReminderOverlay") { title: String, body: String ->
      EmidostOverlay.show(context, "reminder", title, body, null)
      mapOf("shown" to true)
    }
    Function("dismissOverlay") { EmidostOverlay.dismiss(context); true }

    Function("getSimInfo") {
      val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
      mapOf(
        "simState" to tm.simState,
        "carrier" to (tm.networkOperatorName ?: ""),
        "phoneNumber" to (tm.line1Number ?: ""),
        "imsi" to (try { tm.subscriberId } catch (_: Exception) { null }),
        "iccid" to (try { tm.simSerialNumber } catch (_: Exception) { null }),
      )
    }

    Function("isAccessibilityEnabled") { EmidostAccessibilityService.instance != null }
    Function("setEnrolmentSessionActive") { active: Boolean ->
      EmidostAccessibilityService.instance?.setEnrolmentSession(active)
      true
    }

    // Pairing walkthrough helpers (customer app, pre-bind).
    Function("canDrawOverlays") { Settings.canDrawOverlays(context) }
    Function("openOverlaySettings") {
      try {
        val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
        true
      } catch (_: Exception) { false }
    }
    Function("openAccessibilitySettings") {
      try {
        context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) { false }
    }
    Function("openDevelopmentSettings") {
      try {
        context.startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) { false }
    }

    // Transient pairing-dialog readback (10-min expiry, cleared after consume).
    Function("getPairingInfo") { EmidostAdbBridge.pairingInfo() }
    Function("clearPairingInfo") { EmidostAdbBridge.clear(); true }

    Function("getAdbBridgeStatus") { EmidostAdbBridge.status(context) }

    // Bundled-adb self-pair steps (run off the JS thread; 20 s timeout each).
    AsyncFunction("adbPrepare") { EmidostAdbBridge.prepare(context) }
    AsyncFunction("adbPair") { host: String, port: String, code: String ->
      EmidostAdbBridge.pair(context, host, port, code)
    }
    AsyncFunction("adbConnect") { host: String, port: String ->
      EmidostAdbBridge.connect(context, host, port)
    }
    AsyncFunction("adbGrantRuntimePermissions") { pkg: String ->
      EmidostAdbBridge.grantRuntimePermissions(context, pkg)
    }
    AsyncFunction("adbSetDeviceOwner") { pkg: String, adminComponent: String ->
      EmidostAdbBridge.setDeviceOwner(context, pkg, adminComponent)
    }
    AsyncFunction("adbDisableDebugging") { EmidostAdbBridge.disableDebugging(context) }
    AsyncFunction("adbDisconnect") { host: String, port: String ->
      EmidostAdbBridge.disconnect(context, host, port)
    }

    // On-demand location: fetched only when the owner asks (no tracking).
    Function("getLocation") { EmidostLocation.fetch(context) }

    // App foreground: the next command poll should come soon (burst window).
    Function("kickCommandService") { EmidostCommandService.kick(); true }

    Function("rebootDevice") {
      // Orderly reboot, delayed ~5 s so the caller can ack EXECUTED before
      // the device goes down. Refused while locked (no reboot escape) and
      // below API 24 (dpm.reboot is API 24+; minSdk is 23).
      val result = DeviceActions.scheduleReboot(context)
      if (result == "SCHEDULED") mapOf("ok" to true)
      else mapOf("ok" to false, "reason" to result)
    }

    Function("setTotpSecret") { secret: String ->
      Totp.setSecret(context, secret)
      true
    }
    Function("verifyTotpUnlock") { code: String -> Totp.verify(context, code) }

    // ALERT command: one notification + the bn/hi voice pair once.
    Function("speakAlertOnce") { OverdueAlerter.alertOnce(context) }
    // REMIND command: one notification + the friendly bn/hi reminder pair once.
    Function("speakReminderOnce") { OverdueAlerter.reminderOnce(context) }
  }

  private fun isHidden(): Boolean {
    return try {
      val dpm = DeviceActions.dpm(context)
      if (!dpm.isDeviceOwnerApp(context.packageName)) false
      else dpm.isApplicationHidden(DeviceActions.admin(context), context.packageName)
    } catch (_: Exception) { false }
  }

  private fun parseAccounts(json: String?): List<String> {
    if (json.isNullOrBlank()) return emptyList()
    val trimmed = json.trim()
    return if (trimmed.startsWith("[")) {
      val inner = trimmed.removePrefix("[").removeSuffix("]")
      if (inner.isBlank()) emptyList()
      else inner.split(",").map { it.trim().removeSurrounding("\"") }.filter { it.isNotEmpty() }
    } else {
      trimmed.split(",").map { it.trim() }.filter { it.isNotEmpty() }
    }
  }
}
