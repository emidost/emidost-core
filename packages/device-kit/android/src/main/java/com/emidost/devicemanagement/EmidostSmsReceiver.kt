package com.emidost.devicemanagement

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.telephony.SmsManager
import android.telephony.SmsMessage
import java.util.Locale

/**
 * Offline SMS commands from the retailer's registered number (allowlist +
 * customer code gate on every command):
 *   LOCK <code>                  — DO + outstanding + lock plan; 60 s debounced
 *   UNLOCK <code>                — allowlisted retailer number + code; always wins
 *                                  (optional trailing TOTP still accepted)
 *   REMIND <code>                — friendly bn/hi voice once + notification
 *   ALERT <code>                 — urgent bn/hi voice once + notification
 *   LOCATION <code>              — reply SMS with the Google Maps link (or a
 *                                  "location unavailable" reply on no GPS fix)
 * REMIND/ALERT/LOCATION are deliberate retailer actions: gated on an
 * outstanding loan only, NOT on the escalation kill-switch (that toggle
 * governs the AUTOMATIC escalation). REMIND/ALERT share the 60 s per-command
 * debounce so a spoofed SMS cannot spam voice.
 */
class EmidostSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != "android.provider.Telephony.SMS_RECEIVED") return
    if (!SmsCommandStore.isConfigured(context)) return

    val messages = messagesFrom(intent.extras) ?: return
    for (msg in messages) {
      val sender = msg.originatingAddress
      if (sender == null) continue
      if (!SmsCommandStore.senderAllowed(context, sender)) continue
      val body = msg.messageBody?.trim()
      if (body == null) continue
      val parts = body.split(Regex("\\s+"))
      if (parts.size < 2) continue
      val command = parts[0].uppercase()
      val code = parts[1].uppercase()
      if (!SmsCommandStore.codeMatches(context, code)) continue

      when (command) {
        "LOCK" -> {
          // Hard-lock-only, never after settlement/release, and never on a
          // notify_only plan (reminders only, no locking). An identical LOCK
          // within 60 s is debounced (spoofed-SMS DoS hardening).
          val debounced = SmsCommandStore.lockDebounced(context, code)
          if (!debounced &&
            DeviceActions.isOwner(context) &&
            SimSentinelStore.loanOutstanding(context) &&
            SyncStateStore.getLockMode(context) == "lock"
          ) {
            DeviceActions.hardLock(context)
          }
          if (!debounced) EmidostCommandService.kick()
        }
        "UNLOCK" -> {
          // Owner decision: unlock from the allowlisted retailer number with
          // just the customer code, symmetric with LOCK - no TOTP required.
          // (A trailing TOTP is still accepted but optional.) The sender
          // allowlist + customer code were already checked above.
          // Tradeoff, documented honestly: SMS sender numbers can be spoofed,
          // so a forged SMS from the retailer's number carrying the customer
          // code can unlock. Accepted for one-SMS offline convenience. Unlock
          // always wins and stays available after release.
          DeviceActions.releaseLock(context)
          EmidostCommandService.kick()
        }
        "REMIND" -> {
          // Friendly reminder voice + notification; loan-outstanding gated,
          // works even when the escalation kill-switch is off.
          if (!SmsCommandStore.debounced(context, "REMIND", code) &&
            SimSentinelStore.loanOutstanding(context)
          ) {
            OverdueAlerter.reminderOnce(context)
          }
          EmidostCommandService.kick()
        }
        "ALERT" -> {
          // Urgent overdue voice + notification; same gating as REMIND.
          if (!SmsCommandStore.debounced(context, "ALERT", code) &&
            SimSentinelStore.loanOutstanding(context)
          ) {
            OverdueAlerter.alertOnce(context)
          }
          EmidostCommandService.kick()
        }
        "LOCATION" -> {
          // Deliberate retailer action: reply by SMS with the maps link.
          if (!SimSentinelStore.loanOutstanding(context)) continue
          val phone = SmsCommandStore.retailerPhone(context)
          if (phone.isBlank()) continue
          val canSend = try {
            context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
          } catch (_: Exception) { false }
          if (!canSend) continue
          val loc = EmidostLocation.fetch(context, 8000L)
          val msg = if (loc != null) {
            val lat = String.format(Locale.US, "%.6f", loc["lat"])
            val lng = String.format(Locale.US, "%.6f", loc["lng"])
            "emidost: $code phone is here: https://maps.google.com/?q=$lat,$lng"
          } else {
            "emidost: location unavailable for $code"
          }
          try {
            SmsManager.getDefault().sendTextMessage(phone, null, msg, null, null)
          } catch (_: Exception) {}
          EmidostCommandService.kick()
        }
      }
    }
  }

  private fun messagesFrom(extras: Bundle?): List<SmsMessage>? {
    if (extras == null) return null
    val pdus = extras["pdus"] as? Array<*> ?: return null
    return pdus.mapNotNull { p ->
      try { SmsMessage.createFromPdu(p as ByteArray) } catch (_: Exception) { null }
    }
  }
}
