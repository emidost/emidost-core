package com.emidost.devicemanagement

import android.content.Context
import android.telephony.TelephonyManager
import org.json.JSONObject

/**
 * SIM readback (GET_SIM command + SMS SIM). The dialable number (line1Number)
 * is often blank on modern Android without carrier privileges; carrier and
 * IMSI/ICCID are the reliable parts. Every read is wrapped: a SecurityException
 * yields a blank/null field, never a crash.
 */
object SimInfoReader {
  fun json(c: Context): JSONObject {
    val tm = c.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    return JSONObject()
      .put("carrier", tm.networkOperatorName ?: "")
      .put("phoneNumber", try { tm.line1Number ?: "" } catch (_: Exception) { "" })
      .put("imsi", try { tm.subscriberId ?: JSONObject.NULL } catch (_: Exception) { JSONObject.NULL })
      .put("iccid", try { tm.simSerialNumber ?: JSONObject.NULL } catch (_: Exception) { JSONObject.NULL })
  }

  /** One-line SMS reply for the SIM command. */
  fun smsSummary(c: Context, code: String): String {
    val tm = c.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    val carrier = tm.networkOperatorName ?: ""
    val number = try { tm.line1Number ?: "" } catch (_: Exception) { "" }
    val iccid = try { tm.simSerialNumber ?: "" } catch (_: Exception) { "" }
    val last4 = if (iccid.length >= 4) iccid.takeLast(4) else iccid
    val numPart = if (number.isNotBlank()) number else "number n/a"
    return "emidost: $code SIM $carrier $numPart iccid*$last4"
  }
}
