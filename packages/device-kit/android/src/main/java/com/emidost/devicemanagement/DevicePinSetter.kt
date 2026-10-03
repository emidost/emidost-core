package com.emidost.devicemanagement

import android.content.Context
import android.os.Build
import java.security.SecureRandom

/**
 * Sets the EXACT device lock-screen PIN (owner/retailer choice), online or via
 * SMS. resetPassword() is dead for a Device Owner on Android 11+, so the only
 * supported path is a reset-password token (setResetPasswordToken, installed at
 * activation while the phone has no password) + resetPasswordWithToken.
 *
 * Honest limits, reported truthfully and never faked:
 *  - needs API 26+ (returns "needs_api_26" otherwise),
 *  - needs the token set at activation; an already-provisioned phone must be
 *    re-enrolled with this build ("no_token" if it was never installed),
 *  - some Android 13+/OEM builds still refuse a silent set ("os_refused").
 */
object DevicePinSetter {
  private const val PREFS = "emidost_reset_token"

  /** Install the reset-password token once, best at activation (no password yet). */
  fun ensureToken(c: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    if (!DeviceActions.isOwner(c)) return false
    return try {
      val dpm = DeviceActions.dpm(c)
      val admin = DeviceActions.admin(c)
      val prefs = DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val hex = prefs.getString("token", null)
      val token = if (hex != null) hexToBytes(hex) else {
        val t = ByteArray(32)
        SecureRandom().nextBytes(t)
        prefs.edit().putString("token", bytesToHex(t)).apply()
        t
      }
      dpm.setResetPasswordToken(admin, token)
    } catch (_: Exception) { false }
  }

  /** Set the exact PIN. Returns ok plus an honest reason on failure. */
  fun setPin(c: Context, pin: String): Pair<Boolean, String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false to "needs_api_26"
    if (!DeviceActions.isOwner(c)) return false to "not_device_owner"
    if (!Regex("^\\d{4,16}$").matches(pin)) return false to "bad_pin"
    return try {
      val dpm = DeviceActions.dpm(c)
      val admin = DeviceActions.admin(c)
      val prefs = DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      var hex = prefs.getString("token", null)
      if (hex == null) { ensureToken(c); hex = prefs.getString("token", null) }
      if (hex == null) return false to "no_token"
      val ok = dpm.resetPasswordWithToken(admin, pin, hexToBytes(hex), 0)
      if (ok) true to "ok" else false to "os_refused"
    } catch (e: Exception) {
      false to ("exception:" + (e.message ?: "unknown"))
    }
  }

  private fun bytesToHex(b: ByteArray): String {
    val sb = StringBuilder(b.size * 2)
    for (x in b) sb.append(String.format("%02x", x))
    return sb.toString()
  }

  private fun hexToBytes(s: String): ByteArray {
    val out = ByteArray(s.length / 2)
    var i = 0
    while (i < out.size) {
      out[i] = ((Character.digit(s[i * 2], 16) shl 4) + Character.digit(s[i * 2 + 1], 16)).toByte()
      i += 1
    }
    return out
  }
}
