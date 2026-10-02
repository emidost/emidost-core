package com.emidost.devicemanagement

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager

/**
 * SIM removal/swap sentinel. A SIM-absent state for 30 s (debounced) hard-locks
 * the phone. IMSI/ICCID baseline comparison catches SIM swaps. Gated on live
 * Device Owner + outstanding loan; never fires for COMPLETE/SETTLED.
 */
object SimSentinelStore {
  private const val PREFS = "emidost_sim_sentinel"

  fun setBaseline(c: Context, imsi: String, iccid: String) {
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("imsi", imsi).putString("iccid", iccid).apply()
  }

  fun baselineImsi(c: Context): String? =
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("imsi", null)

  fun baselineIccid(c: Context): String? =
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("iccid", null)

  fun loanOutstanding(c: Context): Boolean =
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("loan_outstanding", false)

  fun setLoanOutstanding(c: Context, outstanding: Boolean) {
    c.createDeviceProtectedStorageContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("loan_outstanding", outstanding).apply()
  }
}

class EmidostSimSentinelReceiver : BroadcastReceiver() {
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Runnable? = null

  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != TelephonyManager.ACTION_SIM_CARD_STATE_CHANGED &&
      action != "android.intent.action.SIM_STATE_CHANGED" &&
      action != Intent.ACTION_AIRPLANE_MODE_CHANGED
    ) return

    if (!DeviceActions.isOwner(context)) return
    if (!SimSentinelStore.loanOutstanding(context)) return

    val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    val state = try { tm.simState } catch (_: Exception) { TelephonyManager.SIM_STATE_UNKNOWN }
    val imsi = try { tm.subscriberId } catch (_: Exception) { null }

    val baseline = SimSentinelStore.baselineImsi(context)
    if (baseline != null && imsi != null && imsi != baseline) {
      // SIM swap detected.
      DeviceActions.hardLock(context)
      return
    }

    // IMSI reads can be null on Android 10+ (non-privileged apps). Fall back
    // to the ICCID baseline via SubscriptionManager so swaps still lock.
    val baselineIccid = SimSentinelStore.baselineIccid(context)
    if (baselineIccid != null) {
      val currentIccid = try {
        SubscriptionManager.from(context).activeSubscriptionInfoList
          ?.firstOrNull()?.iccid
      } catch (_: Exception) { null }
      if (!currentIccid.isNullOrBlank() && currentIccid != baselineIccid) {
        DeviceActions.hardLock(context)
        return
      }
    }

    // Only a confirmed ABSENT state locks, after the debounce. UNKNOWN is
    // transient (boot, modem restart) and must not cause false locks.
    if (state == TelephonyManager.SIM_STATE_ABSENT) {
      pending?.let { handler.removeCallbacks(it) }
      pending = Runnable {
        // Re-read the live SIM state at fire time: if a SIM came back during
        // the debounce, do not lock. Also re-check loan + DO state so a
        // settlement that landed meanwhile cancels the lock.
        val nowState = try {
          (context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager).simState
        } catch (_: Exception) { TelephonyManager.SIM_STATE_UNKNOWN }
        if (nowState == TelephonyManager.SIM_STATE_ABSENT &&
          DeviceActions.isOwner(context) && SimSentinelStore.loanOutstanding(context)
        ) {
          DeviceActions.hardLock(context)
        }
      }
      handler.postDelayed(pending!!, 30_000L)
    } else {
      pending?.let { handler.removeCallbacks(it) }
      pending = null
    }
  }
}
