package com.emidost.devicemanagement

import android.content.Context
import android.content.SharedPreferences

/** Config for the background command service: endpoint + device identity. */
object CommandServiceStore {
  private const val PREFS = "emidost_command_service"

  private fun prefs(c: Context): SharedPreferences =
    DpcContext.wrap(c).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun configure(c: Context, baseUrl: String, installationId: String, deviceToken: String) {
    prefs(c).edit()
      .putString("base_url", baseUrl)
      .putString("installation_id", installationId)
      .putString("device_token", deviceToken)
      .apply()
  }

  fun isConfigured(c: Context): Boolean {
    val p = prefs(c)
    return !p.getString("base_url", "").isNullOrEmpty() &&
      !p.getString("installation_id", "").isNullOrEmpty() &&
      !p.getString("device_token", "").isNullOrEmpty()
  }

  fun getBaseUrl(c: Context): String? = prefs(c).getString("base_url", null)
  fun getInstallationId(c: Context): String? = prefs(c).getString("installation_id", null)
  fun getDeviceToken(c: Context): String? = prefs(c).getString("device_token", null)
}
