package com.emidost.devicemanagement

import android.content.Context
import android.content.SharedPreferences
import android.telephony.SmsMessage
import android.util.Base64
import java.security.MessageDigest

/**
 * Offline SMS LOCK/UNLOCK from the retailer's registered number.
 * Format:  LOCK <customer-code>   /   UNLOCK <customer-code>
 * Sender must equal the allowlisted retailer phone; customer code must match.
 * Hard-lock-only: LOCK is refused unless the app is the live Device Owner.
 * SMS is not cryptographically authenticated; the device PIN and TOTP paths
 * are the authenticated fallbacks (documented).
 */
object SmsCommandStore {
  private const val PREFS = "emidost_sms_control"

  fun configure(c: Context, sendersCsv: String, customerCode: String) {
    prefs(c).edit()
      .putString("senders", sendersCsv)
      .putString("customer_code", customerCode)
      .apply()
  }

  fun isConfigured(c: Context): Boolean = !prefs(c).getString("customer_code", "").isNullOrEmpty()

  fun senderAllowed(c: Context, from: String): Boolean {
    val allowed = prefs(c).getString("senders", "")?.split(",")?.map { normalize(it) } ?: return false
    return normalize(from) in allowed
  }

  fun codeMatches(c: Context, code: String): Boolean =
    prefs(c).getString("customer_code", "") == code.trim().uppercase()

  fun normalize(phone: String): String =
    phone.replace(Regex("[^0-9]"), "").takeLast(10)

  private fun prefs(c: Context): SharedPreferences =
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/**
 * Per-device management PIN (owner-set via the portal; replaces the old fixed
 * PIN). The heartbeat delivers pin_verify = sha256(pin + ":" + installation_id);
 * the device compares locally, so checks work fully offline.
 */
object DevicePinStore {
  private const val PREFS = "emidost_pin"

  fun setVerifyHash(c: Context, hash: String) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("verify", hash).apply()
  }

  fun hasPin(c: Context): Boolean =
    !c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("verify", "").isNullOrEmpty()

  fun verify(c: Context, entered: String): Boolean {
    val expected = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("verify", "") ?: return false
    val installationId = CommandServiceStore.getInstallationId(c) ?: ""
    val candidate = sha256("$entered:$installationId")
    return candidate == expected
  }

  fun sha256(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(digest, Base64.NO_WRAP)
  }
}
