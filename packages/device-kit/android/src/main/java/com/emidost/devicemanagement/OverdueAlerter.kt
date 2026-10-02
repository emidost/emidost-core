package com.emidost.devicemanagement

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.telephony.SmsManager
import java.util.Calendar
import java.util.Locale
import java.util.Random

/**
 * Overdue escalation (days 1-5): every 30 min one notification plus the bn/hi
 * voice pair spoken three times (TTS, app-level media, so it plays regardless
 * of mute/DND settings). While overdue the media volume is maxed and, on a
 * live Device Owner, DISALLOW_ADJUST_VOLUME stops the customer muting it.
 * Honest limit: a hardware mute switch can still cut output.
 *
 * Day 3+: twice-daily location SMS to the retailer's registered number
 * (windows 10:00-12:00 and 18:00-20:00 local, a stable random minute per
 * window and day, fired once per window; failures are recorded and the next
 * window retries). Uses the customer's SMS balance (documented).
 *
 * Everything is gated on escalation_enabled + outstanding loan and re-checked
 * at fire time, so there are no zombie alerts after a payment settles.
 */
object OverdueAlerter {

  private const val PREFS = "emidost_overdue"
  private const val CHANNEL = "overdue-alerts"
  private const val NOTIF_ID = 4402
  private const val INTERVAL_MS = 30 * 60_000L

  private const val BN_LINE = "আপনার EMI বকেয়া আছে"
  private const val HI_LINE = "आपकी EMI बकाया है"

  @Volatile private var tts: TextToSpeech? = null
  @Volatile private var pendingSpeech: ((TextToSpeech) -> Unit)? = null

  private fun prefs(c: Context) = DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // --- tick entry (called from EmidostCommandService with live heartbeat state) ---

  fun onTick(c: Context, overdueDays: Int, escalationEnabled: Boolean, outstanding: Boolean) {
    val active = outstanding && escalationEnabled && overdueDays in 1..5
    if (active) {
      val last = prefs(c).getLong("last_alert_at", 0L)
      if (System.currentTimeMillis() - last >= INTERVAL_MS) {
        prefs(c).edit().putLong("last_alert_at", System.currentTimeMillis()).apply()
        fireAlert(c)
      }
      setVolumeLock(c, true)
    } else {
      setVolumeLock(c, false)
    }
    locationSmsIfDue(c, overdueDays, escalationEnabled, outstanding)
  }

  /** Settled/released: clear the volume restriction and stop the TTS engine. */
  fun release(c: Context) {
    setVolumeLock(c, false)
    Handler(Looper.getMainLooper()).post {
      try { tts?.stop() } catch (_: Exception) {}
      try { tts?.shutdown() } catch (_: Exception) {}
      tts = null
      pendingSpeech = null
    }
  }

  /** ALERT command: one notification + the bn/hi pair ONCE. No volume change. */
  fun alertOnce(c: Context): Boolean {
    return try {
      Handler(Looper.getMainLooper()).post {
        postNotification(c)
        speakPair(c, 1)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  // --- 30-min alert ---

  private fun fireAlert(c: Context) {
    Handler(Looper.getMainLooper()).post {
      postNotification(c)
      speakPair(c, 3)
    }
  }

  private fun postNotification(c: Context) {
    try {
      val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(CHANNEL, "Overdue alerts", NotificationManager.IMPORTANCE_MAX)
          .apply { description = "EMI overdue escalation" }
        nm.createNotificationChannel(channel)
      }
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(c, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(c)
      }
      val n = builder
        .setContentTitle("EMI overdue")
        .setContentText("Call your retailer to pay.")
        .setSmallIcon(android.R.drawable.ic_lock_lock)
        .build()
      nm.notify(NOTIF_ID, n)
    } catch (_: Exception) {}
  }

  /**
   * TTS setup (main thread only): bn then hi, QUEUE_ADD, the pair repeated
   * `times` times. The engine initializes asynchronously; speech requested
   * before init completes is queued and played from onInit. If the language
   * pack is missing on a device, TTS skips the utterance silently (honest
   * device-dependent limit).
   */
  private fun speakPair(c: Context, times: Int) {
    val engine = ensureTts(c)
    if (engine != null) {
      doSpeak(engine, times)
    } else {
      pendingSpeech = { doSpeak(it, times) }
    }
  }

  private fun ensureTts(c: Context): TextToSpeech? {
    tts?.let { return it }
    var created: TextToSpeech? = null
    created = TextToSpeech(c.applicationContext) { status ->
      if (status == TextToSpeech.SUCCESS) {
        tts = created
        created?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) {}
          @Deprecated("deprecated")
          override fun onError(utteranceId: String?) {}
        })
        val pending = pendingSpeech
        pendingSpeech = null
        pending?.invoke(created!!)
      } else {
        tts = null
      }
    }
    return null
  }

  private fun doSpeak(engine: TextToSpeech, times: Int) {
    try {
      for (i in 0 until times) {
        engine.language = Locale("bn", "IN")
        engine.speak(BN_LINE, TextToSpeech.QUEUE_ADD, null, "emidost-bn-$i")
        engine.language = Locale("hi", "IN")
        engine.speak(HI_LINE, TextToSpeech.QUEUE_ADD, null, "emidost-hi-$i")
      }
    } catch (_: Exception) {}
  }

  private fun setVolumeLock(c: Context, active: Boolean) {
    try {
      val dpm = DeviceActions.dpm(c)
      val admin = DeviceActions.admin(c)
      if (active) {
        if (DeviceActions.isOwner(c)) {
          dpm.addUserRestriction(admin, UserManager.DISALLOW_ADJUST_VOLUME)
        }
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        am.setStreamVolume(AudioManager.STREAM_MUSIC, max, 0)
      } else {
        if (DeviceActions.isOwner(c)) {
          dpm.clearUserRestriction(admin, UserManager.DISALLOW_ADJUST_VOLUME)
        }
      }
    } catch (_: Exception) {}
  }

  // --- day-3+ location SMS (two windows, stable random minute, once each) ---

  private fun locationSmsIfDue(c: Context, overdueDays: Int, escalationEnabled: Boolean, outstanding: Boolean) {
    if (!outstanding || !escalationEnabled || overdueDays < 3) return
    if (c.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return

    val cal = Calendar.getInstance()
    val year = cal.get(Calendar.YEAR)
    val day = cal.get(Calendar.DAY_OF_YEAR)
    val minutesNow = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE_OF_HOUR)

    val p = prefs(c)
    val storedDay = p.getInt("loc_day", -1)
    var firedMask = if (storedDay == day) p.getInt("loc_windows", 0) else 0
    var updated = false

    for (w in 0..1) {
      if (firedMask and (1 shl w) != 0) continue
      val start = if (w == 0) 600 else 1080 // 10:00 and 18:00 local
      if (minutesNow < start || minutesNow >= start + 120) continue
      // Stable random minute for this day + window; the first tick at or after
      // it fires once.
      val seed = (year * 366L + day) * 2 + w
      val offset = Random(seed).nextInt(120)
      if (minutesNow < start + offset) continue

      firedMask = firedMask or (1 shl w)
      updated = true

      val phone = SmsCommandStore.retailerPhone(c)
      val code = SmsCommandStore.customerCode(c)
      val loc = EmidostLocation.fetch(c, 8000L)
      if (loc != null && phone.isNotBlank()) {
        val lat = String.format(Locale.US, "%.6f", loc["lat"])
        val lng = String.format(Locale.US, "%.6f", loc["lng"])
        val link = "https://maps.google.com/?q=$lat,$lng"
        val msg = "emidost: $code phone is here: $link"
        try {
          SmsManager.getDefault().sendTextMessage(phone, null, msg, null, null)
          p.edit().putString("loc_last_ok", msg).apply()
        } catch (e: Exception) {
          p.edit().putString("loc_last_fail", "send failed: ${e.message}").apply()
        }
      } else {
        p.edit().putString("loc_last_fail", "no GPS fix or no retailer phone").apply()
      }
    }

    if (updated) {
      p.edit().putInt("loc_day", day).putInt("loc_windows", firedMask).apply()
    }
  }
}
