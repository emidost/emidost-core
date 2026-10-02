package com.emidost.devicemanagement

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.telephony.SmsMessage

/**
 * Offline SMS commands. Retailer-number allowlist + customer code + DO gate.
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
          // notify_only plan (reminders only, no locking).
          if (DeviceActions.isOwner(context) &&
            SimSentinelStore.loanOutstanding(context) &&
            SyncStateStore.getLockMode(context) == "lock"
          ) {
            DeviceActions.hardLock(context)
          }
          EmidostCommandService.kick()
        }
        "UNLOCK" -> {
          // Unlock always wins and stays available after release. The body
          // must carry a valid TOTP (authenticated factor): bare-SMS unlock
          // is spoofable and is not accepted.
          if (parts.size >= 3 && Totp.verify(context, parts[2])) {
            DeviceActions.releaseLock(context)
          }
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
