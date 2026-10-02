package com.emidost.devicemanagement

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * On-demand location: fetched ONLY when the owner sends a LOCATION request.
 * No background tracking. Uses last known first, then one single update with
 * a short timeout. Returns { lat, lng, accuracy, at } or null.
 */
object EmidostLocation {
  fun fetch(c: Context, timeoutMs: Long = 8000): Map<String, Any>? {
    val lm = c.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
    val granted = c.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      c.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!granted) return null

    var best: Location? = null
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      try {
        val l = lm.getLastKnownLocation(provider)
        if (l != null && (best == null || l.time > best.time)) best = l
      } catch (_: Exception) {}
    }

    if (best != null && System.currentTimeMillis() - best.time < 10 * 60_000L) {
      return best.toMap()
    }

    // One fresh fix, bounded wait.
    val latch = CountDownLatch(1)
    val holder = arrayOfNulls<Location>(1)
    val listener = object : LocationListener {
      override fun onLocationChanged(location: Location) {
        holder[0] = location
        latch.countDown()
      }
      @Deprecated("deprecated")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      override fun onProviderEnabled(provider: String) {}
      override fun onProviderDisabled(provider: String) {}
    }
    try {
      lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper())
    } catch (_: Exception) {}
    try {
      lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, Looper.getMainLooper())
    } catch (_: Exception) {}
    val done = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    try { lm.removeUpdates(listener) } catch (_: Exception) {}
    return if (done && holder[0] != null) holder[0]!!.toMap() else best?.toMap()
  }

  private fun Location.toMap(): Map<String, Any> = mapOf(
    "lat" to latitude,
    "lng" to longitude,
    "accuracy" to accuracy,
    "at" to time,
  )
}
