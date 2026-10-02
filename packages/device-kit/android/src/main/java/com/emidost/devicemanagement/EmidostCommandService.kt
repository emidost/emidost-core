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
      } catch (_: Exception) {}
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
    // Native 5-day no-internet watchdog (survives a killed app).
    if (SyncStateStore.offlineLockDue(this)) {
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
    val outstanding = loanStatus == "RUNNING" || loanStatus == "NPA"
    SimSentinelStore.setLoanOutstanding(this, outstanding)

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
      val cmd = commands.optJSONObject(i) ?: continue
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
        "LOCATION" -> {
          // Fetched only when asked; nothing is tracked in the background.
          val loc = EmidostLocation.fetch(this)
          extraPayload = JSONObject().put("location", JSONObject(loc ?: emptyMap<String, Any>()))
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

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        "emidost_sync", "emidost protection",
        NotificationManager.IMPORTANCE_LOW,
      ).apply { description = "Keeps device protection in sync" }
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val intent = packageManager.getLaunchIntentForPackage(packageName)
    val pending = if (intent != null) {
      PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
    } else null
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      android.app.Notification.Builder(this, "emidost_sync")
    } else {
      @Suppress("DEPRECATION")
      android.app.Notification.Builder(this)
    }
    return builder
      .setContentTitle("emidost protection")
      .setContentText("Protection is running")
      .setSmallIcon(android.R.drawable.ic_lock_lock)
      .setContentIntent(pending)
      .build()
  }
}
