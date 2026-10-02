# codex audit findings — apps/*, packages/shared, packages/device-kit, workers

Read-only audit against `docs/VERIFICATION_CHECKLIST.md` (sections A–I) and `checksum.md`.
Evidence gathered by reading code + `npx tsc --noEmit` (all six surfaces) + `node --test` (6/6) + `git log/status`.
No files were modified.

## Baseline (verified green)

- `tsc --noEmit` exit 0 for: packages/shared, packages/device-kit, apps/customer, apps/retailer, apps/owner, workers.
- `node --test packages/shared/src/stale.test.mjs` → 6/6 pass.
- Kotlin: previous `?: continue` compile blockers are gone (commit 1671fb5); remaining elvis uses are all `?: return` (valid Kotlin). All classes referenced by the module (`SimSentinelStore`, `DevicePinStore`, `OemPermissionHelper`, …) exist in-package. No remaining obvious Gradle compile blocker found by inspection; a real EAS build is still the only proof (I2/CRED).
- Wiring verified correct: heartbeat URL/fields (`loan_status`, `lock_mode`, `totp_secret`, `pin_verify`, `retailer_phone`, `customer_code`, `server_now`, `commands[]`), ack route, register route, worker dispatch table (2-segment `/api/device/heartbeat` after `/api` strip), PIN hash format (`sha256(pin:installation_id)` base64 NO_WRAP matches Node `digest('base64')`), TOTP format (8 digits, HMAC-SHA1, 30 s, ±1 window, base64 secret — server and `Totp.kt` agree), `lock_mode` accepted by `retailerCustomers` handler.

---

## P0 — blocks checklist items / would fail acceptance on the first device

### CX-1 — Kiosk pinning (`startLockTask`) is never called anywhere; lock-task mode never engages
- Evidence:
  - `packages/device-kit/android/src/main/java/com/emidost/devicemanagement/EmidostDeviceManagementModule.kt:61-73` — `enterLockTask` exists and calls `activity.startLockTask()`.
  - `packages/device-kit/index.ts` — the JS wrapper does **not** export `enterLockTask` (grep: zero callers in every app).
  - `LockPolicies.kt:70-79` (`startKioskIfPermitted`) only relaunches the app; it never pins.
  - `apps/customer/App.tsx` — lock flow calls `showLockOverlay` only; `apps/customer/src/services/sync.ts` never pins.
- Why it matters for 100/100: checklist A8 ("Kiosk engages — setLockTaskPackages, startLockTask, HOME takeover"), D1, D3 ("power menu has no Reboot"), and acceptance H2 ("kiosk pins, PIN cannot leave") all assume lock-task mode is live. `setLockTaskPackages` only whitelists; without `startLockTask()` the device never enters `LOCK_TASK_MODE_LOCKED`, so `LockPolicies.kioskActive()` (live readback) will report `false` on a real phone, the power menu keeps Reboot, and recents/home escape works. This is the single biggest gap between the claims and the code.
- Proposed fix:
  1. Export `enterLockTask(): Promise<boolean>` in `packages/device-kit/index.ts`.
  2. Call it from the customer app whenever locked: in `App.tsx` right after `getDeviceManagementStatus()` shows `enforcedLocked`, and again on `LockedScreen` mount (the app is the HOME, so it is foregrounded).
  3. Re-call after any overlay dismiss/relaunch (cheap idempotent call).

### CX-2 — JS command path executes LOCK with no unlock-wins staleness check (D8 violated)
- Evidence:
  - `apps/customer/src/services/sync.ts:273-296` — the comment claims "the native command service owns the unlock-wins watermark" and then executes every LOCK immediately via `executeAuthorizedLock`, acking EXECUTED/FAILED.
  - `packages/shared/src/stale.ts` (`isLockCommandStale` / `isoToEpochMillis`) is **dead code**: grep shows no app imports it; only `stale.test.mjs` exercises it.
  - `EmidostCommandService.kt:177-184` — the native path *does* check `LockStateStore.isLockStale` and acks SUPERSEDED. The two paths disagree.
- Why it matters for 100/100: a LOCK created before the last unlock can remain PENDING/RECEIVED in the queue (device offline when queued). When the app next opens, the JS loop (60 s) runs before the native idle poll (2 h) and will re-lock an unlocked phone — "unlock always wins" (D8, CONTEXT §4) is false for the JS path. The shared function that was built for exactly this is never wired in.
- Proposed fix: in `sync.ts` LOCK branch, compute staleness with the corrected `isLockCommandStale` (CX-3) using `server_now` from the heartbeat response + the device watermark (`getDeviceManagementStatus` does not expose it, so add `lastUnlockedAt`/`lastUnlockElapsed` to the native status or a small `LockStateStore` reader), and `ack(cmd.id, 'SUPERSEDED')` when stale instead of executing.

---

## P1 — wrong behavior / claim no longer true in code

### CX-3 — `stale.ts` does NOT mirror the fixed native watermark math; the checksum claim is half-true
- Evidence:
  - `packages/shared/src/stale.ts:30-35` — `unlockAtServerTime = lastUnlockWallMs + (nowElapsedMs - lastUnlockElapsedMs)`; `serverNowMs` is only checked for `> 0` and never enters the math, despite the file comment claiming "converted to server time via server_now".
  - `LockStateStore.kt:70-91` (native) uses `serverNowMs - elapsedDelta` (device-wall-clock immune, with a boot-count fallback). checksum.md (improvement arena) claims the fix `unlockAtServerTime = serverNow - elapsedDelta` was applied — true for Kotlin, not for the JS mirror.
- Why it matters: the capture `lastUnlockWallMs` happens on the device wall clock. If the device clock is skewed at unlock time (customer sets clock forward to dodge due dates), fresh LOCKs are wrongly stale (lock refused) for the skew duration, or pre-unlock LOCKs wrongly fresh (re-lock after unlock). Once CX-2 wires this function in, the bug becomes live.
- Proposed fix: `unlockAtServerTime = serverNowMs - (nowElapsedMs - lastUnlockElapsedMs)` with the same boot-count guard semantics as Kotlin; extend `stale.test.mjs` with a "device wall clock ahead at unlock time; server_now immune" case and a reboot case.

### CX-4 — `notify_only` plans can still be hard-locked by the SIM sentinel and SMS LOCK
- Evidence:
  - `EmidostSimSentinelReceiver.kt:49-50` — gates on `isOwner` + `loanOutstanding` only; no `lock_mode` check.
  - `EmidostSmsReceiver.kt:31-37` — SMS LOCK gates on `isOwner` + `loanOutstanding` only.
  - `apps/customer/src/services/sync.ts:234-238` — `setLoanOutstanding(true)` for RUNNING/NPA regardless of `lock_mode`.
  - Retailer app copy (`apps/retailer/App.tsx:318`) promises "Never lock, only reminders. The phone never locks."
- Why it matters: checksum (offline + lock-mode wave) claims "notify_only never locks, reminders only". A notify_only customer on a Device-Owner phone gets hard-locked 30 s after SIM removal, or instantly by a spoofed-SMS LOCK (sender allowlist is spoofable, per the documented caveat). The 5-day watchdog correctly gates on lock_mode; the SIM/SMS paths forgot.
- Proposed fix: add `SyncStateStore.getLockMode(c) == "lock"` to both gates (the native lock_mode is mirrored from every heartbeat, `EmidostCommandService.kt:147`).

### CX-5 — Airplane-mode sentinel registration references a nonexistent broadcast action
- Evidence:
  - `packages/device-kit/app.plugin.js:62` — registers `android.intent.action.AIRPLANE_MODE`.
  - `EmidostSimSentinelReceiver.kt:45-47` — checks `Intent.ACTION_AIRPLANE_MODE_CHANGED` (="android.intent.action.AIRPLANE_MODE_CHANGED").
  - "AIRPLANE_MODE" (without `_CHANGED`) is not a broadcast action; the system never delivers it.
- Why it matters: airplane-mode toggling never reaches the sentinel. On devices where airplane mode reports SIM_STATE_UNKNOWN/NOT_READY rather than ABSENT, the customer can hide the SIM and avoid the lock entirely — the exact escape the sentinel exists to close (D7/H3).
- Proposed fix: change the plugin action to `android.intent.action.AIRPLANE_MODE_CHANGED`.

### CX-6 — Device PIN and TOTP verify exist natively but are wired to no UI; steering PIN-gate claim is false in code
- Evidence:
  - `EmidostAccessibilityService.kt:11-22` — docblock: "the gate asks for the portal-set device PIN (never shown on screen)". Implementation (`onWindowChanged`, :53-69) only relaunches the app; no PIN prompt anywhere.
  - grep: `verifyDevicePin`, `verifyTotpUnlock` are exported (`packages/device-kit/index.ts:123-127,179-180`) but never called by any app. Customer lock screen (`apps/customer/App.tsx:220-324`) has no PIN/TOTP entry.
- Why it matters: D10 ("Device PIN … offline verify") and D11 ("Offline TOTP unlock (owner-issued, audited)") are only half-true end-to-end: TOTP unlock works only when carried inside a retailer SMS (`EmidostSmsReceiver.kt:38-46`). If the retailer is unreachable, the owner-issued TOTP has no entry point on the phone. The steering "PIN gate" described in the a11y docblock does not exist.
- Proposed fix: add a hidden entry (e.g. long-press on the lock emblem, consistent with the existing three-tap diagnostics pattern) on `LockedScreen` that verifies `verifyDevicePin` / `verifyTotpUnlock` and calls `executeAuthorizedUnlock` + ack on success; or wire the PIN prompt into the a11y steering relaunch. Update the a11y docblock to match whichever gate is built.

---

## P2 — polish, doc drift, robustness (fix after the above)

### CX-7 — Library manifest still requests `ACCESS_BACKGROUND_LOCATION` despite commit e20af6a
- Evidence: `packages/device-kit/android/src/main/AndroidManifest.xml:12` declares it; e20af6a ("drop unneeded background-location permission") removed it only from `apps/customer/app.json`. The library manifest merges into the customer APK, so the permission is still requested.
- Fix: remove the line from the device-kit manifest.

### CX-8 — Real FRP account id committed in `apps/customer/.env.example`
- Evidence: `apps/customer/.env.example:4` ships `EXPO_PUBLIC_FRP_ACCOUNTS=106892760455009935120` (also in web/.env.example, SETUP.md, CONTEXT.md). C1 says env-only, never hard-coded — code is clean, but the committed example file carries the live id.
- Fix: replace with a placeholder in the example file and document the id in the local-only env.

### CX-9 — `HeartbeatResponse` type omits half the delivered fields
- Evidence: `packages/shared/src/types.ts:108-116` lacks `pin_verify`, `totp_secret`, `customer_code`, `lock_mode`, `emi_*`, `retailer_name`, `retailer_suspended`, `next_due`, `overdue_days`; `heartbeat.ts` handler returns all of them; `sync.ts` reads them via `resp: any`.
- Fix: complete the interface; type `pollOnce`'s response.

### CX-10 — `CachedState.is_locked` is always false (heartbeat never returns `is_locked`)
- Evidence: `sync.ts:206` reads `resp?.is_locked`; `heartbeat.ts` response object has no `is_locked` key (it selects it from `devices` but never returns it). The cached field is consumed nowhere, so this is dead data today — but it will silently mislead the next consumer.
- Fix: either return `is_locked: device.is_locked` from the heartbeat or drop the field from `CachedState`.

### CX-11 — `SETUP.md` §5 SMS syntax is stale vs the receiver
- Evidence: SETUP.md says `LOCK <customer-code> <pin-if-set>` and `UNLOCK <customer-code>`; `EmidostSmsReceiver.kt:30-47` implements `LOCK <code>` (PIN ignored) and `UNLOCK <code> <totp>` (mandatory 8-digit TOTP). A retailer following SETUP.md cannot unlock.
- Fix: update SETUP.md to the TOTP-gated UNLOCK syntax.

### CX-12 — Retailer Enrol tab never uses the customer's brand; per-OEM walkthrough is generic-only
- Evidence: `apps/retailer/App.tsx:385-394` calls `getOemProfile('', '')` → UNKNOWN → generic steps, regardless of the brand chosen in NewCustomer. A7 evidence ("shared oemMatrix + retailer app Enrol tab") is only half-wired.
- Fix: thread the selected customer/brand into the Enrol tab (small state lift).

### CX-13 — `createApi.createCustomer` type omits `lock_mode` (sent at runtime via spread)
- Evidence: `packages/shared/src/api.ts:53-56` body type lacks `lock_mode`; `apps/retailer/App.tsx:271-276` spreads a form containing it (excess-property check bypassed by spread, so tsc is quiet). The server does accept it (`retailerCustomers.ts:50,57`), so the runtime chain works — but the shared type hides the real contract.
- Fix: add `lock_mode: 'lock' | 'notify_only'` to the type.

### CX-14 — Android 15 FGS reality: dataSync boot-start restriction + 6 h/day cap, silent failure
- Evidence: `EmidostCommandService.start` (:47-56) swallows the start exception; `app.plugin.js:66-74` sets `foregroundServiceType: dataSync`; no `onTimeout` (compileSdk 34, per checksum). On Android 15 the system throws `ForegroundServiceStartNotAllowedException` for dataSync FGS started from BOOT_COMPLETED and stops dataSync FGS after ~6 h/day. The boot receiver's start is caught and lost, so the 2-min re-assert and the 5-day watchdog can be dead until the app is opened. Mitigated because the app is the HOME (boot launches it and JS restarts the service), but on a never-unlocked reboot (direct boot) the guard is absent.
- Fix: (a) log the failure instead of swallowing; (b) switch to `foregroundServiceType: specialUse` where possible, or start the service from `ACTION_LOCKED_BOOT_COMPLETED` via `setAlarm`/WorkManager fallback; (c) document the A15 cap honestly in checksum.

### CX-15 — `rebootDevice` / device-protected storage unguarded on API 23 (minSdk 23)
- Evidence: `EmidostDeviceManagementModule.kt:213-219` calls `dpm.reboot` (API 24) with only try/catch(Exception); `NoSuchMethodError` is an `Error`, not `Exception`, so it would crash on Android 6. Same class of risk for `createDeviceProtectedStorageContext()` (API 24) used by every store. Expo 51 minSdk is 23.
- Fix: add `Build.VERSION.SDK_INT >= N` guards (or raise minSdk in app.json; a DPC phone realistically needs 24+).

### CX-16 — `setUserControlDisabledPackages` may silently no-op on Android 12+ DO, with no honest readback
- Evidence: `FinancingProtection.kt:45-53` swallows the exception; `status()` (:88-114) reports frp/uninstall/restriction readbacks but has no `user_control` field. On Android 12+ device owners on the primary user this API is restricted/deprecated; C4 ("user-control disable") could silently fail and the portal would show no sign.
- Fix: add a `user_control_readback` to `status()` (e.g. `Settings` package launcher intent resolution is hard; at minimum try/catch + report `user_control_applied = isOwner && <attempted>` and log) and note the A12+ caveat in the checklist.

### CX-17 — E1 claim omits the 5-day watchdog: a settled loan that never syncs can still hard-lock
- Evidence: `SyncStateStore.offlineLockDue` (SyncStateStore.kt:26-32) fires on stale `loanOutstanding=true` + stale lock_mode. A customer who pays (loan → COMPLETE server-side) and then stays offline >5 days is still locked locally because the device never heard about the settlement. E1 lists server/JS/SMS/SIM/boot but not the watchdog. Escape hatch exists (SMS UNLOCK + TOTP always wins, `EmidostSmsReceiver.kt:38-46`), and `coreRelease` runs on the next successful heartbeat.
- Fix: document in E1/checksum ("settled + offline >5 days: watchdog can lock; retailer SMS TOTP unlocks; first heartbeat releases"), or lengthen the watchdog grace to 7 days to reduce false locks.

### CX-18 — Small doc/type drift
- `apps/customer/App.tsx:84` comment says the native service "polls slowly (5 min)"; code is 2 h idle / 15 s burst (`EmidostCommandService.kt:33-40`).
- `DeviceStatus` in `packages/device-kit/index.ts:9-15` omits `kioskActive`, which the Kotlin `getDeviceManagementStatus` returns (will matter once CX-1 lands).
- `stale.test.mjs` runs against a function no app imports (see CX-2); tests encode the wall-clock formula, so they cannot catch CX-3.
- `apps/customer/App.tsx:157` passes `info.model` as the OEM `brand` argument (`getOemProfile(info.manufacturer, info.model)`); manufacturer-based detection makes this benign, but pass a real brand/empty string.

---

## Recommended fix plan (ordered)

1. **CX-1** — export + call `enterLockTask` from the customer app when locked (App.tsx + LockedScreen mount). This is the highest-value fix for the checklist (A8/D1/D3/H2).
2. **CX-3** — rewrite `stale.ts` to native math (`serverNowMs - elapsedDelta`, boot-count aware); add regression tests.
3. **CX-2** — wire the staleness check + SUPERSEDED ack into `sync.ts` LOCK branch (needs a native readback of the unlock watermark; add `lastUnlockedAt`/`lastUnlockElapsed`/`boot` to `getDeviceManagementStatus`).
4. **CX-4** — gate SIM sentinel + SMS LOCK on `lock_mode == "lock"`.
5. **CX-5** — fix the airplane-mode action in `app.plugin.js`.
6. **CX-6** — hidden PIN/TOTP entry on the customer lock screen wired to `verifyDevicePin`/`verifyTotpUnlock`; align the a11y steering docblock.
7. **CX-7 → CX-18** — P2 batch (manifest permission, FRP placeholder, HeartbeatResponse type, is_locked wiring, SETUP.md syntax, Enrol-tab brand wiring, createCustomer type, A15 FGS strategy + API-24 guards, status() user-control readback, E1 watchdog note, comment/type drift).
8. Re-run the 6 tsc surfaces + tests; then hand the kiosk change (CX-1) to an EAS build for the Kotlin pass (I2).

## Verdict on my scope's current score

- tsc/tests: 8/8 green; worker/heartbeat/TOTP/PIN/register wiring verified correct end-to-end.
- Hard-lock-only DO gating, honest acks (FAILED without DO), boot re-lock, watermark (native), SIM debounce re-read, settled-loan gates, RELEASE lifecycle: **verified in code**.
- Blocking: kiosk pinning never engages (CX-1) and the JS lock path bypasses unlock-wins (CX-2); notify_only can still be locked (CX-4) and airplane-mode evasion (CX-5).

**Score: 78/100 today.** With CX-1 → CX-6 applied and re-verified (plus the P2 batch), my scope reaches ~97/100; the remaining 3 points are CRED/DEVICE items (EAS Gradle pass, per-family acceptance walks) that no code change can close.
