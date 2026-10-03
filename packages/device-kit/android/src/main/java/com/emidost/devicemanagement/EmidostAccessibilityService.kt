package com.emidost.devicemanagement

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Customer-consented deterrent + enrolment reader.
 *
 * Consent rules (carried from the earlier project, unchanged):
 *  - Enabled ONLY by the retailer via the real system toggle, customer present.
 *  - Never silently or remotely enabled; never restricts other services.
 *  - The ONLY screen content it reads is the wireless-debugging pairing dialog
 *    during an authorized enrolment session (transient RAM regex; nothing
 *    stored, logged, or screenshotted).
 *  - Steering deters uninstall / force-stop / clear-data / Settings tampering
 *    by relaunching the app's own lock screen; leaving the lock screen needs
 *    the portal-set device PIN or an owner-issued TOTP, entered on the hidden
 *    long-press entry of the lock screen (no PIN is handled here, and no
 *    value is ever shown on screen).
 *  - Disabled on release.
 */
class EmidostAccessibilityService : AccessibilityService() {

  private var enrolmentSessionActive = false
  private var enrolmentSessionExpiresAt = 0L
  private var gatedWindowId = -1
  private var gatedAtMs = 0L

  override fun onServiceConnected() {
    instance = this
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val e = event ?: return
    if (!DeviceActions.isOwner(this)) return
    // Steering is a loan-time deterrent only; it stops at release.
    val deterrentActive = SimSentinelStore.loanOutstanding(this)

    when (e.eventType) {
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        // The pairing dialog appears as a new window (a state change), with the
        // IP, port and code already drawn. Read it here too, not only on
        // content-changed - otherwise the values present when the dialog opens
        // are never captured and the automatic read silently does nothing.
        if (enrolmentSessionActive) maybeReadPairingDialog(e)
        onWindowChanged(e, deterrentActive)
      }
      AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
        if (enrolmentSessionActive) maybeReadPairingDialog(e)
      }
    }
  }

  private fun onWindowChanged(e: AccessibilityEvent, deterrentActive: Boolean) {
    if (!deterrentActive) return
    val pkg = e.packageName?.toString() ?: return
    if (pkg == packageName) return
    val steer = pkg == "com.android.settings" ||
      pkg == "com.android.permissioncontroller" ||
      pkg == "com.android.vending" ||
      pkg == "com.miui.securitycenter" ||
      pkg == "com.vivo.permissionmanager" ||
      pkg == "com.coloros.safecenter" ||
      pkg == "com.samsung.android.lool"
    if (!steer) return

    gatedWindowId = e.windowId
    gatedAtMs = System.currentTimeMillis()
    launchOwnApp("steering")
  }

  private fun steerAway(pkg: String?) {
    // No further action: the window-change gate handles the navigation.
  }

  /**
   * Transient read of the pairing dialog during an authorized enrolment
   * session: settings package only, session expiry enforced, RAM only,
   * cleared when the session ends. Nothing stored or logged.
   */
  private fun maybeReadPairingDialog(e: AccessibilityEvent) {
    if (!enrolmentSessionActive) return
    if (System.currentTimeMillis() > enrolmentSessionExpiresAt) {
      setEnrolmentSession(false)
      return
    }
    val eventPkg = e.packageName?.toString()
    // Read the whole active window, not just the node that changed: the pairing
    // dialog's "IP address & Port" line and the 6-digit code live in separate
    // text views, and a content-changed event's source is only the changed
    // subtree, so collecting from it alone usually misses one or both values.
    val root = rootInActiveWindow ?: e.source ?: return
    val rootPkg = root.packageName?.toString()
    // Consent rule: only ever read the Settings app's wireless-debugging screen.
    if (eventPkg != "com.android.settings" && rootPkg != "com.android.settings") return
    val text = StringBuilder()
    collectText(root, text)
    val content = text.toString()
    val pair = Regex("""(\d{1,3}(?:\.\d{1,3}){3}):(\d{4,5})""").find(content)
    // The 6-digit pairing code may render with spaces or dashes between
    // digits ("123 456"); strip non-digits and require exactly 6.
    val codeRaw = Regex("""(?:\D|^)(\d[\d\s\-]{4,}\d)(?:\D|$)""").find(content)?.groupValues?.get(1)
    val code = codeRaw?.replace(Regex("""[^\d]"""), "")?.takeIf { it.length == 6 }
    if (pair != null && code != null) {
      EmidostAdbBridge.onPairingRead(pair.groupValues[1], pair.groupValues[2], code)
    }
    // Main wireless-debugging screen: the CONNECT address follows the
    // "IP address & Port" label and has NO pairing code in the same snapshot.
    // The pairing dialog also carries that label, so a reading is only stored
    // as the connect address when its port differs from the pairing port.
    val connectMatch = Regex(
      """IP\s*address(?:\s*&\s*port)?[^0-9]{0,60}(\d{1,3}(?:\.\d{1,3}){3}):(\d{4,5})""",
      RegexOption.IGNORE_CASE,
    ).find(content)
    if (connectMatch != null && code == null) {
      val connectPort = connectMatch.groupValues[2]
      val pairPort = EmidostAdbBridge.pairingInfo()["port"] as? String ?: ""
      if (pairPort.isEmpty() || connectPort != pairPort) {
        EmidostAdbBridge.onConnectAddressRead(connectMatch.groupValues[1], connectPort)
      }
    }
  }

  private fun collectText(node: AccessibilityNodeInfo?, out: StringBuilder) {
    val n = node ?: return
    n.text?.let { out.append(it).append(' ') }
    for (i in 0 until n.childCount) collectText(n.getChild(i), out)
  }

  override fun onInterrupt() {}

  fun setEnrolmentSession(active: Boolean) {
    enrolmentSessionActive = active
    enrolmentSessionExpiresAt = if (active) System.currentTimeMillis() + 10 * 60_000L else 0L
    if (!active) EmidostAdbBridge.clear()
  }

  fun isEnrolmentSessionActive(): Boolean = enrolmentSessionActive

  fun launchOwnApp(reason: String) {
    val i = packageManager.getLaunchIntentForPackage(packageName) ?: return
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    try { startActivity(i) } catch (_: Exception) {}
  }

  fun isEnabled(c: Context): Boolean {
    val expected = "$packageName/${EmidostAccessibilityService::class.java.name}"
    val enabled = Settings.Secure.getString(
      c.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
  }

  companion object {
    @Volatile var instance: EmidostAccessibilityService? = null
      private set
  }
}
