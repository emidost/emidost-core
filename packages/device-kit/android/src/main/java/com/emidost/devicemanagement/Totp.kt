package com.emidost.devicemanagement

import android.content.Context
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Offline TOTP unlock: the owner issues an 8-digit code from the portal
 * (audited). The secret rides the secure device channel; the check is local,
 * so unlock works with no network. HMAC-SHA1, 30 s windows, one window of skew.
 */
object Totp {
  private const val PREFS = "emidost_totp"

  fun setSecret(c: Context, secret: String) {
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("secret", secret).apply()
  }

  fun hasSecret(c: Context): Boolean =
    !c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("secret", "").isNullOrEmpty()

  fun verify(c: Context, code: String): Boolean {
    val secret = c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("secret", "") ?: return false
    if (code.length != 8) return false
    val counter = System.currentTimeMillis() / 30_000L
    return listOf(counter, counter - 1, counter + 1).any { totp(secret, it) == code }
  }

  private fun totp(secret: String, counter: Long): String {
    return try {
      val keyBytes = android.util.Base64.decode(secret, android.util.Base64.DEFAULT)
      val mac = Mac.getInstance("HmacSHA1")
      mac.init(SecretKeySpec(keyBytes, "HmacSHA1"))
      val msg = java.nio.ByteBuffer.allocate(8).putLong(counter).array()
      val digest = mac.doFinal(msg)
      val offset = digest[digest.size - 1].toInt() and 0x0f
      val bin = ((digest[offset].toInt() and 0x7f) shl 24) or
        ((digest[offset + 1].toInt() and 0xff) shl 16) or
        ((digest[offset + 2].toInt() and 0xff) shl 8) or
        (digest[offset + 3].toInt() and 0xff)
      String.format("%08d", bin % 100_000_000)
    } catch (_: Exception) { "" }
  }
}
