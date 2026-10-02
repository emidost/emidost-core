package com.emidost.devicemanagement

import android.content.Context
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * Wireless-debugging self-pair runner. Drives a bundled AOSP adb client binary
 * (vendored in the RETAILER APK under assets/adb/, Termux android-tools
 * 37.0.0-2 aarch64, Apache-2.0, RUNPATH-patched origin-relative) so the
 * retailer phone can pair/connect to the customer phone and set Device Owner
 * with no PC. Every step reports { ok, output, ... } honestly; a missing or
 * failed binary is reported as "adb binary missing", never faked. The
 * customer APK carries no adb assets by design — this bridge reports the
 * binary as missing there.
 *
 * The transient pairing dialog read (settings package only, 10-min expiry,
 * cleared after consumption) also lives here; the accessibility service feeds
 * it via onPairingRead.
 */
object EmidostAdbBridge {

  private const val ASSET_ZIP = "adb/adb-bundle.zip"
  private const val ASSET_ADB = "adb/adb"
  private const val ASSET_LIB_DIR = "adb/lib"
  private const val PAIRING_TTL_MS = 10 * 60_000L
  private const val TIMEOUT_MS = 20_000L

  @Volatile private var lastPairAddress: String? = null
  @Volatile private var lastPairPort: String? = null
  @Volatile private var lastPairCode: String? = null
  @Volatile private var lastConnectHost: String? = null
  @Volatile private var lastConnectPort: String? = null
  @Volatile private var pairExpiresAt: Long = 0L

  // --- pairing dialog capture (fed by EmidostAccessibilityService) ---

  fun onPairingRead(ip: String?, port: String?, code: String?) {
    if (ip != null) lastPairAddress = ip
    if (port != null) lastPairPort = port
    if (code != null) lastPairCode = code
    if (lastPairAddress != null && lastPairCode != null) {
      pairExpiresAt = System.currentTimeMillis() + PAIRING_TTL_MS
    }
  }

  /** Main wireless-debugging screen: the connect address (a different port than the pairing dialog). */
  fun onConnectAddressRead(host: String?, port: String?) {
    if (host != null) lastConnectHost = host
    if (port != null) lastConnectPort = port
  }

  /** Expired or empty entries are cleared and reported as absent (honest). */
  fun pairingInfo(): Map<String, Any> {
    if (System.currentTimeMillis() > pairExpiresAt) clear()
    return mapOf(
      "address" to (lastPairAddress ?: ""),
      "port" to (lastPairPort ?: ""),
      "code" to (lastPairCode ?: ""),
      "connectHost" to (lastConnectHost ?: ""),
      "connectPort" to (lastConnectPort ?: ""),
      "expiresAt" to pairExpiresAt,
    )
  }

  /** Wipe transient pairing values (session end or explicit consume). */
  fun clear() {
    lastPairAddress = null
    lastPairPort = null
    lastPairCode = null
    lastConnectHost = null
    lastConnectPort = null
    pairExpiresAt = 0L
  }

  // --- binary wiring ---

  private fun adbFile(c: Context): File = File(File(c.filesDir, "emidost-adb/bin"), "adb")

  private fun libDir(c: Context): File = File(File(c.filesDir, "emidost-adb"), "lib")

  private fun preparedMarker(c: Context): File = File(c.filesDir, "emidost-adb/.prepared")

  /** True once a binary asset exists in the APK (runtime copy happens in prepare). */
  fun isImplemented(c: Context): Boolean {
    if (adbFile(c).exists() && adbFile(c).canExecute()) return true
    return try {
      c.assets.open(ASSET_ZIP).close()
      true
    } catch (_: Exception) {
      try {
        c.assets.open(ASSET_ADB).close()
        true
      } catch (_: Exception) {
        false
      }
    }
  }

  private fun copyAsset(c: Context, asset: String, dest: File) {
    if (dest.exists() && dest.length() > 0L) return
    c.assets.open(asset).use { input ->
      dest.outputStream().use { output -> input.copyTo(output) }
    }
  }

  /**
   * Primary path: stream-unzip assets/adb/adb-bundle.zip (entries bin/adb +
   * lib/<name>.so) into filesDir/emidost-adb/, preserving entry paths, then chmod
   * 700 on the adb binary. A `.prepared` marker skips re-unzip on later runs.
   * Fallback: the loose assets/adb/adb + assets/adb/lib/<name> layout. Honest
   * reporting unchanged: "adb binary missing" when neither exists.
   */
  fun prepare(c: Context): Map<String, Any> {
    val adb = adbFile(c)
    val marker = preparedMarker(c)
    if (marker.exists() && adb.exists() && adb.canExecute()) {
      return mapOf("ok" to true, "output" to "${adb.absolutePath} (already prepared)")
    }
    return try {
      val unzipped = unzipBundle(c)
      if (!unzipped) {
        // Loose-asset fallback (older bundles).
        adb.parentFile?.mkdirs()
        libDir(c).mkdirs()
        copyAsset(c, ASSET_ADB, adb)
        val libNames = c.assets.list(ASSET_LIB_DIR) ?: emptyArray()
        for (name in libNames) {
          copyAsset(c, "$ASSET_LIB_DIR/$name", File(libDir(c), name))
        }
      }
      if (!adb.setExecutable(true, true)) {
        return mapOf("ok" to false, "output" to "", "error" to "chmod 700 failed on the adb binary")
      }
      val ok = adb.exists() && adb.canExecute()
      if (ok) {
        try { marker.writeText("prepared") } catch (_: Exception) {}
      }
      mapOf("ok" to ok, "output" to adb.absolutePath)
    } catch (e: Exception) {
      mapOf("ok" to false, "output" to "", "error" to "adb binary missing or copy failed: ${e.message}")
    }
  }

  /** Stream-unzip the compressed bundle into the runtime dir; false when absent or unreadable. */
  private fun unzipBundle(c: Context): Boolean {
    return try {
      c.assets.open(ASSET_ZIP).use { input ->
        ZipInputStream(input.buffered()).use { zis ->
          var entry = zis.nextEntry
          var count = 0
          while (entry != null) {
            val name = entry.name.replace('\\', '/')
            if (!entry.isDirectory) {
              val dest = File(c.filesDir, "emidost-adb/$name")
              dest.parentFile?.mkdirs()
              dest.outputStream().use { out -> zis.copyTo(out) }
              count++
            }
            zis.closeEntry()
            entry = zis.nextEntry
          }
          count > 0
        }
      }
    } catch (_: Exception) {
      false
    }
  }

  /**
   * Run one adb invocation with HOME pointed at filesDir, merged
   * stdout/stderr, and a hard timeout that kills the process. No
   * LD_LIBRARY_PATH: the vendored ELFs use origin-relative RUNPATHs.
   */
  private fun exec(c: Context, args: List<String>, stdin: String? = null): Pair<Int, String> {
    val adb = adbFile(c)
    if (!adb.exists() || !adb.canExecute()) {
      return -1 to "adb binary missing"
    }
    return try {
      val pb = ProcessBuilder(listOf(adb.absolutePath) + args)
      pb.environment()["HOME"] = c.filesDir.absolutePath
      pb.redirectErrorStream(true)
      val p = pb.start()
      if (stdin != null) {
        try {
          p.outputStream.use { out ->
            out.write((stdin + "\n").toByteArray(Charsets.UTF_8))
            out.flush()
          }
        } catch (_: Exception) {}
      }
      val latch = CountDownLatch(1)
      val out = StringBuilder()
      val reader = Thread {
        try {
          p.inputStream.bufferedReader().useLines { lines ->
            lines.forEach { line -> synchronized(out) { out.append(line).append('\n') } }
          }
        } catch (_: Exception) {}
        latch.countDown()
      }
      reader.isDaemon = true
      reader.start()
      val finished = latch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
      if (!finished) {
        try { p.destroy() } catch (_: Exception) {}
        return 124 to "timeout after ${TIMEOUT_MS}ms: $out"
      }
      p.waitFor() to out.toString()
    } catch (e: Exception) {
      -1 to "exec failed: ${e.message}"
    }
  }

  // --- steps (each returns an honest result map) ---

  /** adb pair host:port with the 6-digit code on stdin; positional form as fallback. */
  fun pair(c: Context, host: String, port: String, code: String): Map<String, Any> {
    val target = "$host:$port"
    val (code1, out1) = exec(c, listOf("pair", target), stdin = code)
    if (code1 == 0 && out1.contains("Successfully paired", ignoreCase = true)) {
      return mapOf("ok" to true, "output" to out1.trim())
    }
    // Some builds accept the pairing code positionally.
    val (code2, out2) = exec(c, listOf("pair", target, code))
    if (code2 == 0 && out2.contains("Successfully paired", ignoreCase = true)) {
      return mapOf("ok" to true, "output" to out2.trim())
    }
    return mapOf("ok" to false, "output" to out2.trim().ifBlank { out1.trim() }, "error" to "pair failed")
  }

  /** adb connect host:port; ok only when the output says connected. */
  fun connect(c: Context, host: String, port: String): Map<String, Any> {
    val (code, out) = exec(c, listOf("connect", "$host:$port"))
    val ok = code == 0 && out.contains("connected", ignoreCase = true)
    return mapOf("ok" to ok, "output" to out.trim(), "error" to if (ok) "" else "connect failed")
  }

  /**
   * pm grant the runtime permissions the DPC needs + appops SYSTEM_ALERT_WINDOW.
   * A grant the OS refuses (not changeable) reports {ok:false, skipped:true}
   * and does NOT stop the chain.
   */
  fun grantRuntimePermissions(c: Context, pkg: String): Map<String, Any> {
    val perms = listOf(
      "android.permission.SEND_SMS",
      "android.permission.RECEIVE_SMS",
      "android.permission.READ_PHONE_STATE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    )
    val results = mutableListOf<Map<String, Any>>()
    for (perm in perms) {
      val (code, out) = exec(c, listOf("shell", "pm", "grant", pkg, perm))
      val ok = code == 0 && !out.contains("Unknown permission", ignoreCase = true)
      results.add(mapOf("perm" to perm, "ok" to ok, "skipped" to !ok, "output" to out.trim()))
    }
    val (opCode, opOut) = exec(c, listOf("shell", "appops", "set", pkg, "SYSTEM_ALERT_WINDOW", "allow"))
    val opOk = opCode == 0
    results.add(mapOf("perm" to "appops SYSTEM_ALERT_WINDOW", "ok" to opOk, "skipped" to !opOk, "output" to opOut.trim()))
    return mapOf(
      "ok" to results.all { it["ok"] == true },
      "results" to results,
      "output" to results.joinToString("\n") { "${it["perm"]}: ${if (it["ok"] == true) "ok" else "refused"}" },
    )
  }

  /**
   * dpm set-device-owner, then dpm list device-owners as the readback.
   * ok=true only when the readback contains the component (project rule).
   */
  fun setDeviceOwner(c: Context, pkg: String, adminComponent: String): Map<String, Any> {
    val component = "$pkg/$adminComponent"
    val (setCode, setOut) = exec(c, listOf("shell", "dpm", "set-device-owner", component))
    val (listCode, listOut) = exec(c, listOf("shell", "dpm", "list", "device-owners"))
    val readback = listOut.contains(component)
    val ok = setCode == 0 && listCode == 0 && readback
    return mapOf(
      "ok" to ok,
      "output" to (setOut.trim() + "\n" + listOut.trim()).trim(),
      "readback" to readback,
      "error" to if (ok) "" else "device owner readback failed",
    )
  }

  /** Debug-off cleanup: adb_enabled 0, development_settings_enabled 0, drop adb_wifi_enabled (absent is fine). */
  fun disableDebugging(c: Context): Map<String, Any> {
    val (c1, o1) = exec(c, listOf("shell", "settings", "put", "global", "adb_enabled", "0"))
    val (c2, o2) = exec(c, listOf("shell", "settings", "put", "global", "development_settings_enabled", "0"))
    val (c3, o3) = exec(c, listOf("shell", "settings", "delete", "global", "adb_wifi_enabled"))
    val ok = c1 == 0 && c2 == 0 // the delete may fail when the key was never set
    return mapOf("ok" to ok, "output" to (o1 + o2 + o3).trim(), "error" to if (ok) "" else "debug-off failed")
  }

  /** adb disconnect host:port. */
  fun disconnect(c: Context, host: String, port: String): Map<String, Any> {
    val (code, out) = exec(c, listOf("disconnect", "$host:$port"))
    val ok = code == 0
    return mapOf("ok" to ok, "output" to out.trim(), "error" to if (ok) "" else "disconnect failed")
  }

  /** Honest status for the UI. */
  fun status(c: Context): Map<String, Any> = mapOf(
    "implemented" to isImplemented(c),
    "note" to if (isImplemented(c))
      "Bundled AOSP adb client ready; run prepare once before pairing."
    else "adb binary missing: the assets ship only in the retailer APK (by design).",
    "pair_address" to (lastPairAddress ?: ""),
    "pair_port" to (lastPairPort ?: ""),
    "has_code" to (lastPairCode != null),
  )
}
