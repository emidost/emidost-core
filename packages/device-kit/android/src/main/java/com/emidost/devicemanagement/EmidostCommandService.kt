package com.emidost.devicemanagement

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Background command delivery: START_STICKY foreground service that polls the
 * heartbeat endpoint with the app closed. Hard-lock-only: every LOCK is
 * re-verified against live Device Owner state and the unlock-wins watermark.
 * While locked, re-asserts the hard lock every 2 minutes, fully offline-safe
 * (the re-assert runs before any network call).
 */
class EmidostCommandService : Service() {

  companion object {
    private const val NOTIFICATION_ID = 4401
    private const val CHANNEL_ID = "emidost_sync_quiet"
    private const val LEGACY_CHANNEL_ID = "emidost_sync"
    // 2k-device free-tier budget: idle poll is 2 HOURS (12 req/day/device).
    // SMS is the instant command channel; a 15 s burst runs for 10 minutes
    // after any command, SMS event, or app foreground. The lock itself is
    // fully local and never depends on these polls.
    private const val POLL_SECONDS = 7200L
    private const val BURST_SECONDS = 15L
    private const val REASSERT_MS = 120_000L
    private const val BURST_WINDOW_MS = 10 * 60_000L

    @Volatile var running: Boolean = false
      private set

    @Volatile private var burstUntil: Long = 0L

    fun start(context: Context) {
      val intent = Intent(context, EmidostCommandService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        // Log, never swallow: Android 15 refuses dataSync FGS starts from
        // BOOT_COMPLETED and caps dataSync FGS at ~6 h/day. When the system
        // rejects the start, the 2-min re-assert and the 5-day watchdog are
        // offline until the next launch; on locked devices the app is the
        // HOME, so boot relaunches it and the JS layer restarts the service.
        android.util.Log.w(
          "EmidostCommandService",
          "service start failed (Android 15 dataSync FGS boot restriction or 6 h cap?)",
          e,
        )
      }
    }

    /** A local event (SMS command, app foreground) wants the next poll soon. */
    fun kick() {
      burstUntil = System.currentTimeMillis() + BURST_WINDOW_MS
    }
  }

  private var executor: ScheduledExecutorService? = null
  private var scheduled = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startInForeground()
    if (!CommandServiceStore.isConfigured(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!scheduled) {
      val ex = Executors.newSingleThreadScheduledExecutor()
      executor = ex
      scheduleNext(ex)
      // Local enforcement is independent of network polling: re-assert the
      // hard lock every 2 minutes, offline, even if the app is never opened.
      try {
        ex.scheduleWithFixedDelay(
          { try { reassertIfLocked() } catch (_: Throwable) {} },
          REASSERT_MS, REASSERT_MS, TimeUnit.MILLISECONDS,
        )
      } catch (_: Exception) {}
      scheduled = true
    }
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    try { executor?.shutdownNow() } catch (_: Exception) {}
    executor = null
    scheduled = false
    super.onDestroy()
  }

  private fun scheduleNext(ex: ScheduledExecutorService) {
    if (ex.isShutdown) return
    // Fast only during a burst window; the lock state itself never drives
    // network polls (enforcement is local). +-20% jitter spreads the fleet.
    val fast = System.currentTimeMillis() < burstUntil
    var delay = if (fast) BURST_SECONDS else POLL_SECONDS
    delay = (delay * (0.8 + Math.random() * 0.4)).toLong()
    try {
      ex.schedule({
        try { tick() } catch (_: Throwable) {}
        scheduleNext(ex)
      }, delay, TimeUnit.SECONDS)
    } catch (_: Exception) {}
  }

  private fun tick() {
    // Watchdogs run BEFORE any network call, from persisted state only.
    // Native 5-day no-internet watchdog (survives a killed app).
    if (SyncStateStore.offlineLockDue(this)) {
      executeHardLock()
    }
    // User rule: 4 days with no update AND no internet auto-blocks an overdue
    // phone. Not gated on escalation_enabled (that stops alerts + location
    // SMS only, never locks).
    if (SyncStateStore.overdueOfflineLockDue(this)) {
      executeHardLock()
    }

    val baseUrl = CommandServiceStore.getBaseUrl(this) ?: return
    val installationId = CommandServiceStore.getInstallationId(this) ?: return
    val deviceToken = CommandServiceStore.getDeviceToken(this) ?: return

    val body = JSONObject()
      .put("installation_id", installationId)
      .put("heartbeat", true)
    val resp = postJson("$baseUrl/api/device/heartbeat?installation_id=$installationId", deviceToken, body)
      ?: return

    val loanStatus = resp.optString("loan_status", "")
    if (loanStatus == "COMPLETE" || loanStatus == "SETTLED") {
      coreRelease()
      return
    }

    // Full offline capability, native side: install the server truth so SMS
    // unlock, offline TOTP, the watchdog and protection all work with the app
    // closed or after a reboot.
    SyncStateStore.setLastSyncOk(this, System.currentTimeMillis())
    SyncStateStore.setLockMode(this, resp.optString("lock_mode", "lock"))
    // Watchdog inputs: server overdue days + the cached due row for the local
    // IST day count.
    SyncStateStore.setOverdueDays(this, resp.optInt("overdue_days", 0))
    val nextDue = resp.optJSONObject("next_due")
    SyncStateStore.setDueDate(this, nextDue?.optString("due_date", "") ?: "")
    // Retailer opt-in: gates every automatic lock (watchdogs + SIM sentinel).
    SyncStateStore.setAutoLockOnOverdue(this, resp.optBoolean("auto_lock_on_overdue", false))
    val emiAmt = resp.optDouble("emi_amount", 0.0)
    SyncStateStore.setEmiAmount(this, if (emiAmt > 0) emiAmt.toLong().toString() else "")
    val outstanding = loanStatus == "RUNNING" || loanStatus == "NPA"
    SimSentinelStore.setLoanOutstanding(this, outstanding)

    // Overdue escalation: 30-min voice alerts (days 1-5) + day-3+ location
    // SMS windows. Every fire re-checks the live heartbeat state, so a payment
    // that lands stops the loop (no zombie alerts).
    OverdueAlerter.onTick(
      this,
      resp.optInt("overdue_days", 0),
      resp.optBoolean("escalation_enabled", false),
      outstanding,
    )

    val totpSecret = resp.optString("totp_secret", "")
    if (totpSecret.isNotBlank()) Totp.setSecret(this, totpSecret)
    val pinVerify = resp.optString("pin_verify", "")
    if (pinVerify.isNotBlank()) DevicePinStore.setVerifyHash(this, pinVerify)
    val retailerPhone = resp.optString("retailer_phone", "")
    val customerCode = resp.optString("customer_code", "")
    if (retailerPhone.isNotBlank() && customerCode.isNotBlank()) {
      SmsCommandStore.configure(this, retailerPhone, customerCode)
    }

    // Keep financing protection fresh while the loan is outstanding.
    if (outstanding) {
      try { FinancingProtection.apply(this, true, FinancingProtection.requestedFrpAccounts(this)) } catch (_: Exception) {}
    }

    val commands = resp.optJSONArray("commands") ?: return
    if (commands.length() > 0) burstUntil = System.currentTimeMillis() + BURST_WINDOW_MS
    for (i in 0 until commands.length()) {
      val cmd = commands.optJSONObject(i)
      if (cmd == null) continue
      val status = cmd.optString("status", "")
      if (status != "PENDING" && status != "RECEIVED") continue
      val id = cmd.optString("id", "")
      if (id.isBlank()) continue
      val type = cmd.optString("command_type", "")

      if (type == "LOCK") {
        val createdMs = LockStateStore.isoToEpochMillis(cmd.optString("created_at", ""))
        val serverNowMs = LockStateStore.isoToEpochMillis(resp.optString("server_now", ""))
        if (LockStateStore.isLockStale(this, createdMs, serverNowMs)) {
          ack(baseUrl, installationId, deviceToken, id, "SUPERSEDED")
          continue
        }
      }

      var handled = true
      var ackStatus = "EXECUTED"
      var extraPayload: JSONObject? = null
      when (type) {
        "LOCK" -> {
          val enforced = executeHardLock()
          if (!enforced) ackStatus = "FAILED"
        }
        "UNLOCK" -> executeUnlock()
        "RELEASE" -> coreRelease()
        "SET_PIN_POLICY" -> executePinPolicy()
        "REBOOT" -> {
          // Orderly reboot scheduled ~5 s out so the ack below lands first;
          // refused while locked (no reboot escape) and below API 24.
          val scheduled = DeviceActions.scheduleReboot(this)
          if (scheduled != "SCHEDULED") {
            ackStatus = "FAILED"
            extraPayload = JSONObject().put("reason", scheduled)
          }
        }
        "ALERT" -> {
          // One notification + the bn/hi voice pair once (no volume change).
          if (!OverdueAlerter.alertOnce(this)) ackStatus = "FAILED"
        }
        "REMIND" -> {
          // One notification + the friendly bn/hi reminder pair once.
          if (!OverdueAlerter.reminderOnce(this)) ackStatus = "FAILED"
        }
        "LOCATION" -> {
          // Fetched only when asked; nothing is tracked in the background.
          val loc = EmidostLocation.fetch(this)
          extraPayload = JSONObject().put("location", JSONObject(loc ?: emptyMap<String, Any>()))
        }
        "SET_DEVICE_PIN" -> {
          // Set the exact lock-screen PIN (owner/retailer choice). Reports the
          // real OS outcome; a refusal acks FAILED with an honest reason.
          val pin = cmd.optJSONObject("payload")?.optString("pin", "") ?: ""
          val (ok, reason) = DevicePinSetter.setPin(this, pin)
          if (!ok) { ackStatus = "FAILED"; extraPayload = JSONObject().put("reason", reason) }
        }
        "SET_WALLPAPER" -> {
          val mode = cmd.optJSONObject("payload")?.optString("mode", "") ?: ""
          val ok = if (mode == "clear") EmidostWallpaper.clear(this)
                   else EmidostWallpaper.setReminder(this, EmidostWallpaper.reminderText(this))
          if (!ok) ackStatus = "FAILED"
        }
        "GET_SIM" -> {
          // The SIM readback rides the ack body; ack.ts stores devices.sim_info.
          extraPayload = JSONObject().put("sim_info", SimInfoReader.json(this))
        }
        else -> handled = false
      }
      if (handled) ack(baseUrl, installationId, deviceToken, id, ackStatus, extraPayload)
    }
  }

  /** 2-minute local re-assert, fully offline, independent of the poll timer. */
  private fun reassertIfLocked() {
    if (!LockStateStore.isLocked(this)) return
    if (!DeviceActions.isOwner(this)) return
    val last = LockStateStore.getLastLockAssertAt(this)
    if (System.currentTimeMillis() - last < REASSERT_MS) return
    LockStateStore.setLastLockAssertAt(this, System.currentTimeMillis())
    LockPolicies.apply(this, true)
    try {
      val dpm = DeviceActions.dpm(this)
      if (dpm.isAdminActive(DeviceActions.admin(this))) dpm.lockNow()
    } catch (_: Exception) {}
    if (!EmidostOverlay.isShowing()) {
      EmidostOverlay.show(this, "lock", "Phone locked", "EMI payment required", null)
    }
  }

  /** Hard-lock-only: returns false (no EXECUTED ack) without a live Device Owner. */
  private fun executeHardLock(): Boolean {
    if (!DeviceActions.isOwner(this)) return false
    LockStateStore.setLocked(this, true)
    LockPolicies.apply(this, true)
    LockStateStore.setLastLockAssertAt(this, System.currentTimeMillis())
    try {
      val dpm = DeviceActions.dpm(this)
      if (dpm.isAdminActive(DeviceActions.admin(this))) dpm.lockNow()
    } catch (_: Exception) {}
    EmidostOverlay.show(this, "lock", "Phone locked", "EMI payment required", null)
    return true
  }

  private fun executeUnlock() {
    LockStateStore.setLocked(this, false)
    LockStateStore.setLastUnlockedAt(this, System.currentTimeMillis())
    LockStateStore.setLastUnlockElapsed(this, android.os.SystemClock.elapsedRealtime())
    LockPolicies.apply(this, false)
    EmidostOverlay.dismiss(this)
  }

  private fun executePinPolicy() {
    // resetPassword() is unavailable to DO apps on Android 11+; the policy only
    // forces the customer to set a compliant PIN. No exact PIN value is set.
    if (!DeviceActions.isOwner(this)) return
    try {
      val dpm = DeviceActions.dpm(this)
      dpm.setPasswordQuality(DeviceActions.admin(this), DevicePolicyManager.PASSWORD_QUALITY_NUMERIC)
      dpm.setPasswordMinimumLength(DeviceActions.admin(this), 4)
    } catch (_: Exception) {}
  }

  private fun coreRelease() {
    LockStateStore.setLocked(this, false)
    LockStateStore.setLastUnlockedAt(this, System.currentTimeMillis())
    LockStateStore.setLastUnlockElapsed(this, android.os.SystemClock.elapsedRealtime())
    SimSentinelStore.setLoanOutstanding(this, false)
    LockPolicies.apply(this, false)
    FinancingProtection.apply(this, false, emptyList())
    OverdueAlerter.release(this)
    EmidostOverlay.dismiss(this)
    unhideSelf()
  }

  private fun unhideSelf() {
    try {
      val dpm = DeviceActions.dpm(this)
      if (dpm.isDeviceOwnerApp(packageName)) dpm.setApplicationHidden(DeviceActions.admin(this), packageName, false)
    } catch (_: Exception) {}
  }

  private fun ack(
    baseUrl: String,
    installationId: String,
    deviceToken: String,
    id: String,
    status: String,
    extra: JSONObject? = null,
  ) {
    try {
      val body = JSONObject().put("command_id", id).put("ack_status", status)
      extra?.let { e ->
        val keys = e.keys()
        while (keys.hasNext()) {
          val k = keys.next()
          body.put(k, e.get(k))
        }
      }
      postJson(
        "$baseUrl/api/device/command/ack?installation_id=$installationId",
        deviceToken,
        body,
      )
    } catch (_: Exception) {}
  }

  private fun postJson(urlStr: String, deviceToken: String, body: JSONObject): JSONObject? {
    var conn: HttpURLConnection? = null
    try {
      conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 20_000
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("X-Device-Token", deviceToken)
        doOutput = true
      }
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      if (conn.responseCode !in 200..299) return null
      val text = conn.inputStream.bufferedReader().use { it.readText() }
      return JSONObject(text)
    } catch (_: Exception) {
      return null
    } finally {
      try { conn?.disconnect() } catch (_: Exception) {}
    }
  }

  private fun startInForeground() {
    val notification = buildNotification()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Exception) {}
  }

  // The foreground service must stay: the 2-minute offline lock re-assert and
  // the 5-day watchdog run on this process's executor. Without a foreground
  // service, Android 8+ stops a background service within about a minute of
  // the app leaving the foreground. Alarms cannot replace it, because Doze
  // throttles setExactAndAllowWhileIdle to about once every 9 minutes. So the
  // service keeps running, but its notification is kept as quiet as Android
  // allows: an IMPORTANCE_MIN channel with no sound, vibration or badge, and
  // short, calm text.
  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      // A channel's importance cannot be lowered once it exists, so the quiet
      // channel uses a new id and the old IMPORTANCE_LOW channel is removed.
      try { nm.deleteNotificationChannel(LEGACY_CHANNEL_ID) } catch (_: Exception) {}
      val channel = NotificationChannel(
        CHANNEL_ID, "Phone protection",
        NotificationManager.IMPORTANCE_MIN,
      ).apply {
        description = "Keeps device protection in sync"
        setSound(null, null)
        enableVibration(false)
        enableLights(false)
        setShowBadge(false)
      }
      nm.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
    val pending = if (intent != null) {
      PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
    } else null
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.Notification.Builder(this, CHANNEL_ID)
    } else {
      // Pre-O has no channels: the same quietness is set on the notification.
      @Suppress("DEPRECATION")
      android.app.Notification.Builder(this)
        .setPriority(Notification.PRIORITY_MIN)
        .setSound(null)
        .setVibrate(null)
        .setDefaults(0)
    }
    return builder
      .setContentTitle("Phone protection")
      .setContentText("Protection is on")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setContentIntent(pending)
      .setOngoing(true)
      .setShowWhen(false)
      .setOnlyAlertOnce(true)
      .build()
  }
}
