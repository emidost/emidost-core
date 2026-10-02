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
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> onWindowChanged(e, deterrentActive)
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
    val pkg = e.packageName?.toString() ?: return
    if (pkg != "com.android.settings") return
    val text = StringBuilder()
    collectText(e.source, text)
    val content = text.toString()
    val pair = Regex("""(\d{1,3}(?:\.\d{1,3}){3}):(\d{4,5})""").find(content)
    val code = Regex("""(?:^|\D)(\d{6})(?:\D|$)""").find(content)
    if (pair != null || code != null) {
      EmidostAdbBridge.onPairingRead(pair?.groupValues?.get(1), pair?.groupValues?.get(2), code?.groupValues?.get(1))
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
