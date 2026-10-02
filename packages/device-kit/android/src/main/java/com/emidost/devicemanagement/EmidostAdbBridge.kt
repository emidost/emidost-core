package com.emidost.devicemanagement

import android.content.Context
import android.os.Build

/**
 * Stage-1 spike skeleton: on-device wireless-debugging self-pair.
 *
 * What is proven (research, sources in the shared package): the pairing server
 * binds all interfaces, so connecting to the phone's own Wi-Fi IP is loopback;
 * the flow is ALPN "adbpair" (TLS, trust-all for the local pairing session) ->
 * CNXN/AUTH SPAKE2 (AOSP pairing_connection.cpp draft-08 constants) -> RSA
 * keypair -> then ALPN "adb" with AUTH SIGNATURE -> OPEN shell:.
 *
 * What is NOT yet implemented (marked honestly): the SPAKE2 point math and the
 * AOSP constants. This file is the wiring and the command surface; the crypto
 * lands in the Stage-1 spike and is validated against a real phone before any
 * enrolment path depends on it. Until then, enrolment uses the provisioning QR.
 */
object EmidostAdbBridge {

  @Volatile private var lastPairAddress: String? = null
  @Volatile private var lastPairPort: String? = null
  @Volatile private var lastPairCode: String? = null

  fun onPairingRead(ip: String?, port: String?, code: String?) {
    if (ip != null) lastPairAddress = ip
    if (port != null) lastPairPort = port
    if (code != null) lastPairCode = code
  }

  /** Wipe transient pairing values when the enrolment session ends. */
  fun clear() {
    lastPairAddress = null
    lastPairPort = null
    lastPairCode = null
  }

  fun isSpikeReady(): Boolean = false // becomes true only after a real device pass

  /** Placeholder until the spike: reports the honest state to the UI. */
  fun status(): Map<String, Any> = mapOf(
    "implemented" to false,
    "note" to "SPAKE2 self-pair is a Stage-1 device spike; use the provisioning QR until it passes.",
    "pair_address" to (lastPairAddress ?: ""),
    "pair_port" to (lastPairPort ?: ""),
    "has_code" to (lastPairCode != null),
  )
}
