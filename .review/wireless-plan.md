# Wireless-debugging self-pair plan (lead decision, 2026-10-03)

Goal (user): no PC anywhere. Retailer installs the customer APK on the target
phone from the QR, grants overlay + accessibility once, enables wireless
debugging, the pairing code is verified automatically, and the phone comes
under app control.

## Reality check (why a bundled adb, not a Kotlin SPAKE2)

The ADB pairing handshake is SPAKE2 inside TLS 1.3 with ALPN `adbpair` and a
PSK callback. Android's javax.net.ssl/Conscrypt exposes no TLS 1.3 PSK mode, so
a from-scratch Kotlin implementation would need an embedded BoringSSL — weeks
of work and untestable here. The proven on-device approach is the one
Termux/Remote-Adb-Shell use: run a real AOSP adb client binary on the
retailer phone. Decision: vendor the AOSP adb binary (Apache-2.0) from the
official Termux `android-tools` package (recorded URL + sha256 + NOTICE) and
drive it from the device-kit module. This is the honest way to make `adb pair`
real; the checklist will say "bundled AOSP adb client", not "Kotlin SPAKE2".

## Flow (retailer phone = controller, customer phone = target)

Target side (customer app installed from the QR):
1. Walkthrough: overlay grant (one tap, system dialog) → enable the app's
   accessibility service (one Settings switch) → the service then auto-walks
   developer options + toggles wireless debugging (per-OEM matrix) and reads
   BOTH the pairing dialog (pairing ip:port + 6-digit code) AND the main
   screen's connect ip:port (different port numbers on stock Android; settings
   package only, 10-min expiry, cleared after).
2. The target app shows the numbers BIG (pairing ip:port, code, connect
   ip:port) + a small QR `emidost://pair?...` (follow-up) — v1: staff reads
   the numbers.
Retailer side (retailer app, new "Wireless enrol" flow):
3. Staff enters ip, pairing port, code, connect port (B5 staff-typed
   fallback, the designed path).
4. App drives the vendored adb: `adb pair ip:pairing-port` (code fed to stdin
   when the binary prompts; also passed positionally when supported) →
   `adb connect ip:connect-port` → `pm grant` list → `appops set
   SYSTEM_ALERT_WINDOW allow` → `dpm set-device-owner
   com.emidost.customer/com.emidost.devicemanagement
   .EmidostDeviceAdminReceiver` → `dpm list device-owners` readback (must
   contain the component) → debug-off cleanup (`adb_enabled 0`,
   `development_settings_enabled 0`, delete `adb_wifi_enabled`) → disconnect.
   Each step reports { ok, output, readback } honestly; a failed step stops
   the chain and shows the exact adb output.
5. The target app continues the normal bind/activation (heartbeat,
   mode=device_owner readback, hideSelf).

The QR-provisioning path (A) stays the documented alternative; this becomes
path B.

## Binary conventions (LEAD FETCHED + PATCHED — FINAL, supersedes earlier text)

- Source: Termux official apt repo, `android-tools` 37.0.0-2 (aarch64) + its
  resolved runtime libraries (56 libs, full dependency closure, no missing
  deps). Every ELF DT_RUNPATH was patched from the Termux prefix to
  origin-relative (`adb` → `$ORIGIN/../lib`, libs → `$ORIGIN`) so the bundle
  runs from any app's files dir (Android ignores LD_LIBRARY_PATH).
- Location in repo: `apps/retailer/android-assets/adb/{adb,lib/*,NOTICE.md,
  SHA256SUMS}` — RETAILER app only. The customer APK must never carry an adb
  client (claude's flag), so the assets do NOT live in packages/device-kit.
- A retailer config plugin (apps/retailer) copies
  `apps/retailer/android-assets/adb/` into the android project's
  `main/assets/adb/` at prebuild, so the module bridge can read them by name
  at runtime.
- Runtime layout (EmidostAdbBridge.prepare): copy `assets/adb/adb` →
  `filesDir/emidost-adb/bin/adb` (chmod 700) and `assets/adb/lib/*` →
  `filesDir/emidost-adb/lib/*`. Env: HOME=filesDir (LD_LIBRARY_PATH not needed
  — RUNPATHs are origin-relative). Exec each step with a 20 s timeout, kill on
  expiry, capture stdout+stderr.
- Honest runtime guard: when the assets are absent (customer APK), the bridge
  reports `adb binary missing`, never fakes a step.

## Threat-table residual fixes decided now

1. **Portal lock indicator lag on code unlocks** — heartbeat request gains
   `locked: boolean` (device's enforcedLocked readback). Server: report true →
   `devices.is_locked=true`; report false → clear ONLY when no PENDING/RECEIVED
   LOCK/DEVICE_ACTION exists. Closes codex's flagged item.
2. **SMS LOCK spoof DoS** — native debounce: ignore an identical SMS LOCK for
   the same customer within 60 s (DoS hardening; UNLOCK path untouched).
3. **SIM baseline null on some devices** — `getDeviceManagementStatus` gains
   `simBaselinePresent` so the portal/honest status can show it (reporting,
   not a fake fix).
4. **5-day watchdog vs settled loans** — keep 5 days (business decision);
   residual stays documented with the TOTP SMS escape. No change.
5. Everything else in the table stays an honest documented residual
   (hardware-hold reboot, FRP OS readback, A12+ user-control, rooted-device
   token theft, FGS 6 h cap, in-memory limiter).

## Write scopes (disjoint)

- claude: web/ (heartbeat handler), docs/ + CONTEXT/SETUP/checklist/checksum.
- codex: packages/device-kit (bridge + manifest + assets wiring + SMS
  debounce + simBaselinePresent), packages/shared (types/status), apps/customer
  (pairing walkthrough + code display screen), apps/retailer (wireless enrol
  flow), workers unchanged.
- lead: fetch/verify the adb + libc++ binaries into `.review/adb-bin/` with a
  NOTICE (sha256, source URL); final verify; commit; push.
