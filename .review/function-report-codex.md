# emidost function report — codex half (apps, packages/shared, packages/device-kit, workers)

Claim-by-claim review of every function in this scope, verified against the code
this session (Phases 1–3). Line numbers reference the working tree at the last
verified commit (1778c6f). Device-acceptance items are marked CODE+DEVICE and
never claimed as passed. Merged by the lead into docs/FUNCTION_REPORT.md.

## 1. Customer app (apps/customer)

### App (apps/customer/App.tsx:20)
- **Claim**: Root component that binds the phone, runs the heartbeat loop, and renders the lock screen when locked.
- **How it works**: On mount it checks `isRegistered()`; unbound phones show `BindScreen`, bound phones call `startSync()`. A single-flight 60 s interval (App.tsx:45-95, `inFlight` ref) runs `pollOnce()`, then reads native `getDeviceManagementStatus()`; when `enforcedLocked` it shows the overlay and calls `enterLockTask()`, otherwise `exitLockTask()`. `locked` state drives `LockedScreen`.
- **What it prevents**: Overlapping heartbeat rounds (double polls), stale UI state, and a locked phone whose kiosk pinning silently lapses.
- **Status**: CODE verified.

### BindScreen (apps/customer/App.tsx:155)
- **Claim**: Binds the phone to a retailer-issued enrolment token.
- **How it works**: Reads device info via `getDeviceInfo()`, shows the OEM profile via `getOemProfile(manufacturer, '')`, and calls `registerWithToken(code, deviceInfo)`; on success transitions to `active`.
- **What it prevents**: Anonymous/unbound devices talking to the heartbeat; the device cannot self-provision an identity.
- **Status**: CODE verified (server-side token consumption is web scope).

### getInstallationId / getDeviceToken (apps/customer/src/services/sync.ts:87,96)
- **Claim**: Mints one stable device identity pair from a CSPRNG.
- **How it works**: `expo-crypto` `getRandomBytes` (16/32 bytes) → hex; persisted in AsyncStorage once and memoized in module memory.
- **What it prevents**: `Math.random`-predictable identities/tokens being guessed and spoofed against the device API.
- **Status**: CODE verified.

### registerWithToken (apps/customer/src/services/sync.ts:124)
- **Claim**: Registers the installation with the enrolment token, then starts the native command service.
- **How it works**: POST `/api/device/register` with lowercased token, installation_id, device_token and device info; on success marks registered and calls `startSync()`.
- **What it prevents**: Replayed/broken bindings — registration is one-time and the server consumes the token atomically (web scope).
- **Status**: CODE verified (device half of the round trip; token semantics are web scope).

### startSync (apps/customer/src/services/sync.ts:151)
- **Claim**: Boots the native foreground command service with the device identity.
- **How it works**: `configureCommandService(API_URL, installationId, deviceToken)` then `startCommandService()`.
- **What it prevents**: The phone losing command delivery when the app is closed or killed.
- **Status**: CODE verified.

### pollOnce (apps/customer/src/services/sync.ts:170)
- **Claim**: One heartbeat round: full server truth → local cache + native mirrors + reminders + command execution.
- **How it works**: Posts `{ mode }` with the X-Device-Token to `/api/device/heartbeat`; caches loan_status/lock_mode/next_due/pin_verify/totp_secret/customer_code/is_locked (`saveCachedState`, sync.ts:197-213); mirrors sync-ok + lock_mode natively; on COMPLETE/SETTLED runs release-once (cancel reminders, unlock, sentinel off, protection off, unhide); schedules/cancels reminders; applies FRP protection for RUNNING/NPA; configures SMS control + PIN + TOTP (each via `applyOnce`, sync.ts:110, so unchanged values are not re-applied); sets the SIM baseline exactly once; hides "wifi" once mode=device_owner; then executes PENDING/RECEIVED commands with ack.
- **What it prevents**: A device that forgets its loan state when offline, repeated native churn, a settled loan that stays locked, and a phone that stays visible in the launcher.
- **Status**: CODE verified.

### Command execution + ack (apps/customer/src/services/sync.ts:300-330, ack at :318)
- **Claim**: Executes LOCK/UNLOCK/RELEASE/LOCATION from the heartbeat and acks each honestly.
- **How it works**: LOCK first runs `isLockCommandStale` (see stale.ts below) against `server_now` and the native watermark readback and acks `SUPERSEDED` when stale; otherwise `executeAuthorizedLock` (native hard-lock gate) and ack EXECUTED/FAILED with reason. UNLOCK/RELEASE execute + release-side effects + EXECUTED. LOCATION fetches on demand and acks the fix.
- **What it prevents**: A stale LOCK (created before the last unlock) re-locking an unlocked phone — the JS path now matches the native unlock-wins watermark.
- **Status**: CODE verified.

### enforceOfflineWatchdog (apps/customer/src/services/sync.ts:64)
- **Claim**: 5-day no-internet local hard-lock for lock plans only.
- **How it works**: Reads cached state; skips unless `lock_mode === 'lock'` and loan RUNNING/NPA and a sync has ever succeeded; if `Date.now() - lastSyncOkAt >= 5 days` calls `executeAuthorizedLock('offline-watchdog')`.
- **What it prevents**: A customer switching off the internet for days to dodge locking. notify_only plans never lock.
- **Status**: CODE verified (mirrored natively in SyncStateStore.offlineLockDue).

### unlockWithCode (apps/customer/src/services/sync.ts:338)
- **Claim**: Offline unlock by portal-set device PIN or owner-issued TOTP.
- **How it works**: Tries `verifyDevicePin(code)` then `verifyTotpUnlock(code)`; on success `executeAuthorizedUnlock` + `kickCommandService` (server acks of pending commands happen on the next poll).
- **What it prevents**: A locked, fully-offline phone with no escape when the retailer cannot SMS — the owner's audited TOTP or the portal PIN still unlocks it.
- **Status**: CODE verified; honest limit: a code unlock has no command_id, so server `devices.is_locked` clears via the next poll/command ack, not instantly.

### scheduleReminders / cancelReminders (apps/customer/src/services/sync.ts:369,387)
- **Claim**: −3/−1/0/+1/+3 day reminder set rebuilt from the DB due row.
- **How it works**: `expo-notifications` channel + `scheduleNotificationAsync` date triggers at 09:00 local around `next_due`; the whole set is replaced when the due signature changes and cancelled on COMPLETE/SETTLED.
- **What it prevents**: Stale/duplicate reminders and reminders after settlement.
- **Status**: CODE verified; honest limit: exact alarm delivery on Android 12+ can degrade without SCHEDULE_EXACT_ALARM (accepted; reminders are advisory, not enforcement).

### LockedScreen (apps/customer/App.tsx:227)
- **Claim**: Dark locked UI with pay/call-retailer/112 actions and a hidden unlock-code entry.
- **How it works**: Re-asserts `enterLockTask()` on mount (App.tsx:243); breathing ring animation honors reduced motion; three live actions use `showCallOverlay` (ACTION_DIAL); long-press on the lock emblem (App.tsx:307-330) reveals a numeric entry wired to `unlockWithCode`, with `onUnlocked` refreshing state via `pollOnce()`.
- **What it prevents**: A locked screen with no emergency path (112 stays reachable), no retailer contact, and no offline unlock escape; also prevents the kiosk pin from being the only enforcement (defense in depth).
- **Status**: CODE verified + DEVICE (112 dial and overlay behavior on real OEMs).

### Diagnostics (apps/customer/App.tsx:390)
- **Claim**: Hidden protection-status readout behind three taps.
- **How it works**: Three taps toggle `showDebug`; renders `getProtectionStatus()` entries and hidden state.
- **What it prevents**: Customers reading store tooling while giving the retailer a support surface.
- **Status**: CODE verified.

### hideSelf / unhideSelf (device-kit index.ts:118-124 → EmidostDeviceManagementModule.kt:163-171)
- **Claim**: Hides "wifi" from the launcher while active; unhides on release.
- **How it works**: `dpm.setApplicationHidden(admin, pkg, hidden)` gated on live Device Owner; JS calls hide when mode=device_owner + outstanding loan (sync.ts:273) and unhide in the settled/release paths (sync.ts:227,307).
- **What it prevents**: The customer uninstalling/finding the DPC from the app drawer.
- **Status**: CODE verified + DEVICE (launcher behavior per OEM).

## 2. Retailer app (apps/retailer)

### App + Login (apps/retailer/App.tsx:41,111)
- **Claim**: Session-gated shell with four tabs; Supabase email/password sign-in.
- **How it works**: `supabase.auth.getSession()` on mount; the header reads the retailer's credits/lock allowances straight from the DB (RLS-scoped read).
- **What it prevents**: Unauthenticated access to retailer tooling.
- **Status**: CODE verified.

### Customers (apps/retailer/App.tsx:140)
- **Claim**: FlatList of customers with status + plan chips, setup-code mint, and inline payment recording.
- **How it works**: `api.listCustomers()` via bearer token; chips derive from `status`/`lock_mode`; RUNNING/NPA rows expose `SetupCode` and `PaymentRow`.
- **What it prevents**: Server-truth drift (summaries come from the DB) and selling actions on settled rows (setup code is hidden for COMPLETE/SETTLED).
- **Status**: CODE verified.

### SetupCode (apps/retailer/App.tsx:183)
- **Claim**: Mints the one-time 15-minute enrolment token shown once.
- **How it works**: `api.createEnrolment(customerId, {})` → token + expires_at; busy-guarded.
- **What it prevents**: Replayed enrolment tokens (only the hash is stored server-side, web scope).
- **Status**: CODE verified.

### PaymentRow (apps/retailer/App.tsx:225)
- **Claim**: Records a cash payment against the customer.
- **How it works**: `api.recordPayment(customerId, { amount, method: 'cash' })` with a busy guard against double submits; refreshes the list on success.
- **What it prevents**: Double-submitted payments and overstated balances (server allocates against amount_due − amount_paid, web scope).
- **Status**: CODE verified.

### NewCustomer (apps/retailer/App.tsx:269)
- **Claim**: Customer registration with the full EMI fields and the lock-plan choice.
- **How it works**: Form → `api.createCustomer({ ..., lock_mode })` (typed in shared api.ts); the brand value is lifted to the Enrol tab via `onBrand`; busy guard on save.
- **What it prevents**: A customer silently defaulting to the wrong plan; the choice is explicit ("Lock on missed payment" vs "Never lock, only reminders").
- **Status**: CODE verified.

### Devices (apps/retailer/App.tsx:361)
- **Claim**: Device list with LOCK/UNLOCK (server allowance-checked) and offline unlock code.
- **How it works**: `api.listDevices()`; toggle sends LOCK/UNLOCK through the API (allowance debit happens server-side on command insert, web scope); each row has an "Offline unlock code" button opening `UnlockCodeScreen`.
- **What it prevents**: Retailers locking beyond their allowance and losing access to offline unlock when the phone has no internet.
- **Status**: CODE verified.

### UnlockCodeScreen (apps/retailer/App.tsx:418)
- **Claim**: Authenticator-style 8-digit offline unlock code generator for one device.
- **How it works**: Reads SecureStore `emidost.retailer.unlockkey.<deviceId>`; on miss calls `api.getDeviceUnlockKey(deviceId)` and caches the base64 secret; a 1 s interval recomputes `totpCode(secret, now)` (flips at each 30 s boundary, cleared on unmount); 30 s SVG countdown ring (strokeDashoffset per second) with a plain "New code in Xs" text under reduced motion; Copy via expo-clipboard; 409 → "The phone has no unlock key yet. It must complete one online sync before offline unlock works.", network failure with no cache → "No saved key. Connect once to load it."; guidance: "Long-press the lock emblem on the phone, then type this code."; header shows customer name (resolved via listCustomers) + device model.
- **What it prevents**: A locked, offline phone with no unlock path when the retailer has no SMS signal — the same secret the phone verifies (Totp.kt) is generated locally and fully offline after the first fetch.
- **Status**: CODE verified (generator math proven by RFC 6238 vectors + node:crypto cross-check; phone-side acceptance is the H5/H6 device walk).

### Enrol (apps/retailer/App.tsx:558)
- **Claim**: Brand-threaded per-OEM enrolment walkthrough + portal QR deep link.
- **How it works**: `getOemProfile(brand, brand)` from the brand chosen in NewCustomer (empty → generic near-stock steps); renders setup steps + gate hint + "Open portal QR page" (`Linking.openURL(API_URL + '/qr')`).
- **What it prevents**: Staff following the wrong OEM steps (Samsung Auto Blocker, MIUI optimization, restricted settings) and enrolments failing at the counter.
- **Status**: CODE verified (walkthrough content is research-grade; per-family certification is DEVICE).

## 3. Owner app (apps/owner)

### App + Login (apps/owner/App.tsx:34,85)
- **Claim**: Owner shell (retailers/new/audit) behind Supabase email/password.
- **How it works**: Same session pattern as the retailer app.
- **What it prevents**: Unauthenticated owner tooling.
- **Status**: CODE verified.

### Retailers (apps/owner/App.tsx:114)
- **Claim**: Retailer list with suspend/resume, credit top-ups, and allowance sets.
- **How it works**: FlatList over `api.listRetailers()`; suspend via PATCH `is_suspended`; credits via `api.allocateCredits(r.id, { delta, kind: 'topup' })`; allowances via `api.setLockAllowances(r.id, n)`; busy guard + `Number.isFinite`/`>= 0` NaN/negative guards.
- **What it prevents**: Accidental negative top-ups, NaN allowances, and double submits corrupting the ledger.
- **Status**: CODE verified.

### NewRetailer (apps/owner/App.tsx:210)
- **Claim**: Creates a retailer login (name, phone, login id, password).
- **How it works**: `api.createRetailer({...})` — the server creates the auth user + staff profile (web scope); the phone is the future SMS sender.
- **What it prevents**: Retailers without an audit-visible, owner-controlled account.
- **Status**: CODE verified.

### Audit (apps/owner/App.tsx:249)
- **Claim**: Audit trail list.
- **How it works**: FlatList over `api.listAudit()` (owner-gated server-side); empty state added.
- **What it prevents**: Blind operations — every credit/allowance/TOTP/PIN action lands in the audit log (web scope) and is visible here.
- **Status**: CODE verified.

## 4. packages/device-kit — Kotlin

### EmidostDeviceManagementModule (EmidostDeviceManagementModule.kt:17)
- **Claim**: The Expo native surface for the whole device-management kit.
- **How it works**: ~40 `Function(...)` bindings over the stores/services below; each reads/writes through Device-Actions gates.
- **What it prevents**: JS talking to Android APIs directly; every enforcement call funnels through one auditable surface.
- **Status**: CODE verified (Kotlin compiled only in EAS builds — inspected compile-clean, not locally compiled).

### DeviceActions.hardLock (DeviceActions.kt:38)
- **Claim**: Hard lock that refuses without a live Device Owner.
- **How it works**: `isOwner(c)` (live `dpm.isDeviceOwnerApp` readback) → set locked state, `LockPolicies.apply(true)`, `lockNow`, overlay; returns "HARD_LOCK_REFUSED" otherwise. No soft fallback exists.
- **What it prevents**: A non-DO device acing EXECUTED for a lock it never enforced — the module/service ack FAILED instead (D1/D2).
- **Status**: CODE verified + DEVICE (real-device DO readback).

### LockPolicies.apply / startKioskIfPermitted / kioskActive (LockPolicies.kt:16,70,82)
- **Claim**: The full kiosk lock set: lock-task whitelist, call block, feature flags, HOME takeover, kiosk launch.
- **How it works**: DO-gated; `setLockTaskPackages(admin, [pkg])`; `DISALLOW_OUTGOING_CALLS` add/clear (framework keeps 112 dialable); `setLockTaskFeatures` = KEYGUARD + SYSTEM_INFO only while locked (NOTIFICATIONS omitted because Android requires HOME; GLOBAL_ACTIONS deliberately excluded so the kiosk power menu has no Reboot); `addPersistentPreferredActivity` HOME takeover / clear on release; relaunches the app when permitted. `kioskActive()` is the live `lockTaskModeState == LOCKED` readback, reported in status (never faked).
- **What it prevents**: Power-menu Reboot escape, home-button escape, and non-emergency outgoing calls while locked; the readback catches silently failed pinning.
- **Status**: CODE verified + DEVICE (actual pinning/power menu per OEM family).

### enterLockTask / exitLockTask (EmidostDeviceManagementModule.kt:68,82)
- **Claim**: Pin/unpin the foreground activity into lock-task mode.
- **How it works**: DO + `isLockTaskPermitted` → `activity.startLockTask()`; `stopLockTask()` on exit (exception-safe). The customer app calls enter when `enforcedLocked` and exit when unlocked (App.tsx:79,82; LockedScreen mount :243).
- **What it prevents**: The whitelist being set but lock-task mode never actually engaging (the historical gap); and the customer staying pinned after a legitimate unlock.
- **Status**: CODE verified + DEVICE.

### FinancingProtection.apply / restore / status (FinancingProtection.kt:39,94,102)
- **Claim**: Uninstall block, factory-reset/safe-boot/add-user/debugging/clock restrictions, user-control disable, and FRP from env accounts.
- **How it works**: DO-gated `setUninstallBlocked` + five `addUserRestriction`s + `setUserControlDisabledPackages` (API 30+; attempt recorded); FRP via `setFactoryResetProtectionPolicy` from the JS-delivered `EXPO_PUBLIC_FRP_ACCOUNTS` (never hard-coded; remembered in prefs and re-applied on boot via `restore`). `status()` reports OS readbacks plus honest fields: `frp_os_confirmed=false` and `user_control_os_confirmed=false` (Android exposes neither readback).
- **What it prevents**: Factory reset/FRP wipe, safe-boot, second users, ADB tampering, clock manipulation, uninstall of the DPC, and the customer disabling the DPC/Settings through user control.
- **Status**: CODE verified; honest limit: FRP OS-side application and user-control effect are unverifiable until a device walk (C3/C4 = CODE+DEVICE).

### EmidostBootReceiver (EmidostBootReceiver.kt:14)
- **Claim**: Boot auto-lock + protection restore + service restart.
- **How it works**: Handles BOOT_COMPLETED / LOCKED_BOOT_COMPLETED / QUICKBOOT_POWERON; reads state from device-protected storage (DpcContext); restores financing protection, restarts the command service, and when persisted state is LOCKED + DO: `lockNow`, overlay cover, and relaunch (HOME takeover lands the reboot on the lock screen).
- **What it prevents**: A reboot or battery-pull clearing the lock — the phone re-locks before the customer can use it.
- **Status**: CODE verified + DEVICE (boot behavior per OEM; A15 dataSync FGS start-from-boot restriction is logged, see command service).

### EmidostCommandService (EmidostCommandService.kt:29)
- **Claim**: START_STICKY foreground command service: heartbeat polling, 2-min offline re-assert, watchdog, honest acks.
- **How it works**: `start()` logs (not swallows) FGS start failures, with an honest comment about the Android 15 dataSync boot restriction and ~6 h/day cap (the HOME app relaunch is the mitigation); a 2 h idle / 15 s burst poll (kick() pulls it into a 10-min burst window) with ±20% jitter; every tick runs `SyncStateStore.offlineLockDue` (5-day watchdog) before any network call; processes PENDING/RECEIVED commands — LOCK re-checks the unlock-wins watermark (`LockStateStore.isLockStale`, server_now-based) and acks SUPERSEDED when stale; non-DO LOCK acks FAILED; COMPLETE/SETTLED triggers coreRelease and stops command delivery; a separate 2-min timer (`reassertIfLocked`) re-applies LockPolicies + lockNow + overlay fully offline; `rebootDevice` refuses while locked.
- **What it prevents**: Locks evaporating when the app is closed, a stale LOCK re-locking after unlock, a settled loan staying locked, and silent service-start failures.
- **Status**: CODE verified; honest limit: Android 15 dataSync FGS caps mean the poll can die after ~6 h/day until the next launch (enforcement itself is local and unaffected).

### EmidostSmsReceiver (EmidostSmsReceiver.kt:12)
- **Claim**: Offline SMS LOCK/UNLOCK from the retailer's number.
- **How it works**: `SMS_RECEIVED` → configured? → sender normalized (last-10-digits) against the allowlisted retailer phone → customer code match → LOCK executes only when live DO + outstanding loan + lock plan (`lock_mode == "lock"`); UNLOCK requires a valid 8-digit TOTP as the third token and always wins; every accepted SMS kicks the burst poll.
- **What it prevents**: Random SMS locking phones (allowlist + code), a spoofed-SMS unlock (TOTP required — bare SMS unlock is not accepted), a settled/notify_only phone being locked, and commands sitting unacked while offline.
- **Status**: CODE verified + DEVICE (Android 14+ SMS delivery restrictions per family); honest limit: SMS sender IDs are spoofable, so LOCK from a spoofed number remains possible by design (documented; TOTP-gated UNLOCK and the portal paths are the authenticated fallbacks).

### EmidostSimSentinelReceiver / SimSentinelStore (EmidostSimSentinelReceiver.kt:39,17)
- **Claim**: SIM removal/swap sentinel: 30 s debounced absent-lock, IMSI/ICCID swap detection.
- **How it works**: On SIM_STATE_CHANGED / SIM_CARD_STATE_CHANGED / AIRPLANE_MODE_CHANGED; gates: live DO + outstanding loan + lock plan (notify_only never locks); IMSI baseline mismatch → immediate hard lock; ICCID baseline via SubscriptionManager catches Android 10+ null-IMSI swaps; a confirmed ABSENT state schedules a 30 s debounce that re-reads the live SIM state, DO and loan at fire time before locking.
- **What it prevents**: A customer ejecting or swapping the SIM to escape the lock; false locks from transient UNKNOWN states (only confirmed ABSENT locks, re-verified at fire time).
- **Status**: CODE verified + DEVICE (baseline reads can be null on some devices — documented).

### EmidostAccessibilityService (EmidostAccessibilityService.kt:26)
- **Claim**: Customer-consented steering deterrent + enrolment pairing-dialog reader.
- **How it works**: Enabled only via the real system toggle; steering (Settings/permission-manager/Play/Security-center packages) relaunches the app's lock screen while the loan is outstanding — unlocking there needs the portal PIN or owner TOTP (hidden entry); the ONLY content read is the wireless-debugging pairing dialog during an authorized session: settings package only, 10-min expiry enforced, regex in RAM, values cleared when the session ends (`AdbBridge.clear`).
- **What it prevents**: A customer tampering with Settings to disable protection, and any permanent reading/logging of screen content (transient, scoped, cleared).
- **Status**: CODE verified; honest limit: deterrence quality per OEM is DEVICE.

### Totp.verify (Totp.kt:22)
- **Claim**: Offline RFC 6238 verification of the owner's 8-digit TOTP.
- **How it works**: HMAC-SHA1 over the big-endian 8-byte counter (now/30 s), dynamic truncation, `% 100_000_000`, 8-digit compare with ±1 window; the secret is the base64 string delivered over the authenticated heartbeat.
- **What it prevents**: A stale/offline unlock code being rejected, and any code outside the 90 s acceptance window working.
- **Status**: CODE verified (byte-exact with the portal generator and the new shared totp.ts; cross-checked by tests).

### DevicePinStore.verify (SmsCommandStore.kt:61)
- **Claim**: Offline verification of the portal-set device PIN.
- **How it works**: Compares `sha256(pin + ":" + installation_id)` (Base64 NO_WRAP) against the heartbeat-delivered `pin_verify`; the hash never leaves service-role storage except to the device.
- **What it prevents**: A PIN stored or compared in plaintext; a stolen DB row directly yielding the PIN (brute-force of the salted hash is the documented residual risk for 4-8 digit PINs).
- **Status**: CODE verified; honest limit: 4-8 digit PINs are brute-forceable from the hash offline — accepted tradeoff, documented.

### SyncStateStore / LockStateStore (SyncStateStore.kt:10; LockStateStore.kt:17)
- **Claim**: Device-protected persistence for watchdog state and the unlock-wins watermark.
- **How it works**: `SyncStateStore.offlineLockDue` (5-day, lock-plan + loan-gated) and `LockStateStore.isLockStale` (`unlockAtServerTime = serverNowMs − elapsedDelta` with a boot-count same-boot guard and a wall+skew fallback after reboot); all prefs via `DpcContext` (API-24-safe).
- **What it prevents**: A killed app losing the watchdog/watermark (survives reboot via direct boot), a changed device wall clock voiding a fresh LOCK or resurrecting a stale one, and crashes on Android 6.
- **Status**: CODE verified.

### DpcContext.wrap (DpcContext.kt:12)
- **Claim**: API-24-safe device-protected storage wrapper.
- **How it works**: `createDeviceProtectedStorageContext()` on API 24+, plain context below (minSdk 23).
- **What it prevents**: `NoSuchMethodError` crashes on Android 6 devices.
- **Status**: CODE verified.

### EmidostAdbBridge (EmidostAdbBridge.kt:20)
- **Claim**: Stage-1 SPAKE2 self-pair skeleton, honestly unimplemented.
- **How it works**: Holds transient pairing values, `clear()` on session end, `status()` reports `implemented=false` with the note to use the provisioning QR.
- **What it prevents**: Claiming a wireless self-pair path that cannot work — the QR path is the only claimed enrolment route.
- **Status**: SPIKE — not implemented (honest).

### OemFingerprint / OemPermissionHelper (OemFingerprint.kt:25,115)
- **Claim**: 22-brand OEM detection + autostart/battery settings deep links.
- **How it works**: Manufacturer/brand matching (Xiaomi/vivo/OPPO/HONOR/Samsung/Transsion/near-stock) → family profile with verified component intents; helper opens the first resolvable autostart/background-popup screen, falling back to battery-optimization settings.
- **What it prevents**: Staff guessing per-OEM setup steps and the DPC being killed by OEM battery managers.
- **Status**: CODE verified (research-grade matrix; per-family certification is DEVICE).

### EmidostLocation.fetch (EmidostLocation.kt:20)
- **Claim**: On-demand single location fix, only when the owner asks.
- **How it works**: Last-known first (10-min freshness), else one bounded single update (8 s timeout); no background tracking.
- **What it prevents**: Constant background location collection; the device only reports when a LOCATION command arrives.
- **Status**: CODE verified.

## 5. packages/shared

### isLockCommandStale (packages/shared/src/stale.ts:42)
- **Claim**: JS mirror of the native unlock-wins watermark.
- **How it works**: `unlockAtServerTime = serverNowMs − (nowElapsedMs − lastUnlockElapsedMs)` when same boot; wall+skew fallback after reboot; missing data fails toward stale. Used by the customer app's LOCK branch to ack SUPERSEDED.
- **What it prevents**: A fresh LOCK being voided by device-clock games, and a pre-unlock LOCK re-locking after unlock.
- **Status**: CODE verified (9/9 node tests).

### totpCode / totpSecondsLeft / base64ToBytes (packages/shared/src/totp.ts:35,58,16)
- **Claim**: Retailer-side RFC 6238 generator, byte-exact with Totp.kt.
- **How it works**: jsSHA HMAC-SHA1 over the big-endian counter; 8 digits via `% 100_000_000` + padStart; padding-tolerant pure-JS base64 decode (same bytes as android.util.Base64.DEFAULT); `totpSecondsLeft` = seconds to the next 30 s boundary (1..30).
- **What it prevents**: The retailer's offline code drifting from what the locked phone accepts (wrong digits/window/base64 would strand the customer).
- **Status**: CODE verified (RFC 6238 vectors + node:crypto cross-check, 4/4).

### createApi (packages/shared/src/api.ts:15)
- **Claim**: Typed bearer-authenticated client for every API route the apps use.
- **How it works**: `req()` attaches the Supabase access token (or X-Device-Token for device routes) and throws with status + body on failure; methods cover owner/retailer/device surfaces incl. `sendCommand` and `getDeviceUnlockKey`.
- **What it prevents**: Apps calling endpoints with the wrong shape/verb, and (with web-side gates) cross-role access.
- **Status**: CODE verified.

### getOemProfile / detectFamily / OEM_NOTES (packages/shared/src/oemMatrix.ts:39,26,156)
- **Claim**: The 22-brand verified OEM matrix used by both apps.
- **How it works**: Manufacturer/brand regex detection → per-family profile with setup steps, autostart/battery needs, restricted-settings path and pairing gate hints; platform notes record resetPassword reality, GLOBAL_ACTIONS default, A13+ restricted settings.
- **What it prevents**: Untested OEM advice being presented as fact; every family is only "certified" after a device walk.
- **Status**: CODE verified (research); per-family certification = DEVICE.

### copy.ts (lockScreenCopy / dueReminderCopy / COPY_RULES) (packages/shared/src/copy.ts:72,27,4)
- **Claim**: en/bn/hi lock-screen and reminder copy under the humanizer rules.
- **How it works**: Sentence-case, verb-first, no slop words, concrete numbers; `dueReminderCopy` feeds both the notification body and the voice playback.
- **What it prevents**: Inconsistent, alarming, or AI-slop copy on a financially sensitive screen.
- **Status**: CODE verified.

### designTokens (packages/shared/src/designTokens.ts:175)
- **Claim**: Single source of color/type/space/motion tokens.
- **How it works**: Role accents (indigo/teal/amber), dark=locked palette, 4 px space, motion durations, reduced-motion helpers (`prefersReducedMotion`, `resolveDuration`, `withReducedMotion`).
- **What it prevents**: Divergent visual language across the three apps and the portal.
- **Status**: CODE verified.

## 6. workers/src/index.ts

### Worker fetch router (workers/src/index.ts:73)
- **Claim**: Cloudflare Worker that serves the exact route table of the Next.js catch-all.
- **How it works**: Strips an optional `/api` prefix, matches the 20+ RouteDefs (same handlers imported from web/lib/apiHandlers, incl. `retailerUnlockKey` added in Phase 3), wires `:id` params, and shims `NextRequest`/`next/headers`; `nodejs_compat` provides node:crypto for the shared handlers; `@/lib/auth` is replaced by the bearer-token `authAdapter`.
- **What it prevents**: Behavior drift between the Vercel host and the Worker host (both serve identical handlers), and cookie-dependence on a runtime that has no cookie jar.
- **Status**: CODE verified (tsc 0; runtime deploy is the lead's CRED item).

## 7. Threat table

| Abuse vector | Blocking function(s) | Residual risk (honest) |
|---|---|---|
| Eject SIM to escape lock | `EmidostSimSentinelReceiver` (30 s debounce, ABSENT-only, re-read at fire) | IMSI/ICCID baseline can be null on some devices (documented); airplane-mode coverage now registered correctly, device walk pending |
| Swap SIM to a friend's | `SimSentinelStore` IMSI/ICCID baseline compare | Baseline set once; a cleared app-data re-baseline is gated by re-registration (device walk pending) |
| Spoof retailer SMS to unlock | `EmidostSmsReceiver` — UNLOCK requires a valid 8-digit TOTP | SMS LOCK from a spoofed number remains possible by design (documented); DoS-only |
| Spoof SMS / SIM event to lock a settled or notify_only phone | `EmidostSmsReceiver` + `SimSentinelReceiver` loan + `lock_mode` gates | Stale loan state on a never-synced device is the documented edge (TOTP SMS unlock always wins) |
| Stale LOCK command re-locks after unlock | `LockStateStore.isLockStale` (native) + `isLockCommandStale` (JS) + SUPERSEDED acks | After-reboot wall+skew fallback is approximate by design (unlock still wins on missing data) |
| Reboot/power menu escape | `LockPolicies` (no GLOBAL_ACTIONS) + `EmidostBootReceiver` auto-lock + HOME takeover | Hardware hold/battery-pull unblockable; boot re-lock must hold per OEM (DEVICE) |
| Factory reset / FRP bypass | `FinancingProtection` (DISALLOW_FACTORY_RESET, safe-boot, add-user, debugging, FRP policy) | FRP OS-side application unverifiable in code (honest `frp_os_confirmed=false`); device walk required |
| Uninstall DPC / disable via Settings | `setUninstallBlocked` + `setUserControlDisabledPackages` + app hidden from launcher | Android 12+ can refuse user-control for DO on the primary user (attempt recorded, readback honest) |
| Set device clock to dodge due dates / watermark | `DISALLOW_CONFIG_DATE_TIME` + server_now-based watermark math | Clock changes before DO enrolment are unblocked; watermark still server-anchored |
| Turn off internet for weeks | 5-day offline watchdog (JS + native mirror), lock-plan-gated | notify_only never locks (by design); settled-but-offline >5 days can lock until first sync or TOTP SMS unlock (documented) |
| Stolen/guessed device token or enrolment token | CSPRNG identities, one-time enrolment token, token-hash compare server-side | Token theft from a rooted device is out of scope |
| Retailer over-spends credits/allowances | Server-side debit/refund RPCs + owner app busy/NaN guards (client half) | Web-side atomicity is claude's scope; client guards only prevent fat-finger errors |
| Locked phone with no network and no SMS | `unlockWithCode` (PIN/TOTP hidden entry) + `UnlockCodeScreen` (offline generator, SecureStore cache) | Server `is_locked` clears on next ack, not instantly for code unlocks |
| Kiosk pinning silently not engaging | `enterLockTask` re-asserted each loop + `kioskActive` live readback in status | Real pinning needs the device walk (A8/H2) |
| Background service killed / never started (A15 FGS caps) | START_STICKY + boot receiver + HOME-app relaunch + logged failures | dataSync 6 h/day cap is an honest limit; enforcement is local and unaffected |

## Coverage count

74 functions covered across: customer app (11), retailer app (9), owner app (5),
device-kit Kotlin (26), packages/shared (12), workers (1 router), plus the threat
table (12 rows). All claims match code verified this session; no device-walk item
is claimed as passed.

## Flagged for lead verification

1. `EmidostDeviceManagementModule.rebootDevice` guard is in place, but no UI calls
   `rebootDevice` anywhere — D4 is satisfied only at the API level.
2. Worker runtime deploy of the new `unlock-key` route is a CRED step (lead).
3. `devices.is_locked` does not clear instantly on a PIN/TOTP code unlock (no
   command_id) — cleared by the next UNLOCK-command ack or poll; if the portal
   must reflect it immediately, a heartbeat-reported state write is a follow-up.
