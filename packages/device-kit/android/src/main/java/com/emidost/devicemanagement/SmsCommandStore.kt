package com.emidost.devicemanagement

import android.content.Context
import android.content.SharedPreferences
import android.telephony.SmsMessage
import android.util.Base64
import java.security.MessageDigest

/**
 * Offline SMS LOCK/UNLOCK from the retailer's registered number.
 * Format:  LOCK <customer-code>   /   UNLOCK <customer-code> <totp>
 * Sender must equal the allowlisted retailer phone; customer code must match.
 * Hard-lock-only: LOCK is refused unless the app is the live Device Owner, the
 * loan is outstanding, and the plan is a lock plan (notify_only never locks).
 * UNLOCK requires a valid TOTP (authenticated factor); bare SMS is spoofable.
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

  /**
   * SMS LOCK DoS debounce: an identical LOCK for the same customer code within
   * 60 s is ignored (spoofed-SMS LOCK floods can otherwise spam the lock
   * overlay). UNLOCK is untouched. Returns true when the command is debounced.
   */
  fun lockDebounced(c: Context, customerCode: String): Boolean {
    val p = prefs(c)
    val lastCode = p.getString("last_lock_code", "")
    val lastAt = p.getLong("last_lock_at", 0L)
    val now = System.currentTimeMillis()
    if (lastCode == customerCode && now - lastAt < 60_000L) return true
    p.edit().putString("last_lock_code", customerCode).putLong("last_lock_at", now).apply()
    return false
  }

  private fun prefs(c: Context): SharedPreferences =
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/**
 * Per-device management PIN (owner-set via the portal; replaces the old fixed
 * PIN). The heartbeat delivers pin_verify = sha256(pin + ":" + installation_id);
 * the device compares locally, so checks work fully offline.
 */
object DevicePinStore {
  private const val PREFS = "emidost_pin"

  fun setVerifyHash(c: Context, hash: String) {
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("verify", hash).apply()
  }

  fun hasPin(c: Context): Boolean =
    !DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("verify", "").isNullOrEmpty()

  fun verify(c: Context, entered: String): Boolean {
    val expected = DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("verify", "") ?: return false
    val installationId = CommandServiceStore.getInstallationId(c) ?: ""
    val candidate = sha256("$entered:$installationId")
    return candidate == expected
  }

  fun sha256(input: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(digest, Base64.NO_WRAP)
  }
}
