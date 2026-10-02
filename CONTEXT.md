# emidost — comprehensive project context

One file. Everything an agent or a human needs to keep working on this project
without guessing. Last updated 2026-10-02.

## 1. What this is

emidost is a financed-phone EMI lock system for phone retailers. A phone sold on
EMI stays locked (kiosk, Device Owner) until every instalment is paid. Three
roles, one backend, two GitHub repos, one Supabase project, one deployed portal.

| Repo | Visibility | Purpose |
|---|---|---|
| github.com/emidost/emidost | public | Landing page + APK downloads |
| github.com/emidost/emidost-core | public | Full system (this repo) |

Local folders: `D:\emidost` (core), `D:\emidost2` (landing, pushed to
github.com/emidost/emidost).

## 2. Live infrastructure (verified 2026-10-02)

- **Architecture rule: Supabase is the single source of truth.** Auth, data,
  RLS policies, and every business rule (ledger, allowances, payments,
  commands, rate limits) live in the Supabase Postgres DB and are enforced
  there. The Vercel portal and the Cloudflare worker are STATELESS edges that
  execute the same `web/lib/apiHandlers` code and hold no data of their own
  (verified: no KV, no D1, no caches, no bindings in wrangler.toml). The apps
  read through RLS and write through the API; the only transient state is the
  documented per-instance in-memory rate limiter, whose cross-instance
  counterpart is the Supabase `rate_limits` table.
- Supabase: `https://fhmndtznwtchqrfuobyq.supabase.co` (project ref
  `fhmndtznwtchqrfuobyq`). Keys live in `web/.env.local` + `apps/*/.env`
  (gitignored; never commit).
- Portal: https://emidost-pd8s.vercel.app (login 200, API auth 401 = healthy).
- Push (optional layer): Expo Push Service sends a WAKE-ONLY data-only kick
  (`{ type: 'kick' }`, no command content) when a command is queued; the phone
  still fetches the real command via its authenticated heartbeat, so a forged
  push can at most trigger one poll. Layered fallback: push → heartbeat poll →
  SMS. Phones without Play Services simply never register a token and ride
  polling. Tokens live in `devices.fcm_token`, revoked from anon/authenticated
  (0013); sent via `web/lib/fcm.ts` with an optional `EXPO_PUSH_ACCESS_TOKEN`.
  App-side token registration + kick listener is the customer app's half.
- Database: schema applied (tables verified). Indexes in
  `supabase/migrations/0002_perf_indexes.sql` (part of the all-in-one).
- Accounts (no customer login exists; customers are retailer-created):
  - Owner: dip@emidost.in (role owner; password chosen by the owner via scripts/set_owner.mjs)
  - Retailer: retailer@emidost.in / Retailer@Pass123 (retailer_staff, bound to
    "Demo Phone House" with 10 credits, 50 lock allowances)
  - Demo customer row: Samsung Galaxy A15, 12 months, Rs 2,400/month, due day 5
- FRP account (env only): `EXPO_PUBLIC_FRP_ACCOUNTS=106892760455009935120`
- SQL: one file does everything: `supabase/migrations/0000_all_in_one.sql`
  (schema + indexes; NOT the seeds — accounts come from
  `scripts/create_accounts.mjs` via the admin API because the SQL editor cannot
  write auth.users).
- Claude Code MCP: `.mcp.json` wires the Supabase MCP (project-scoped).

## 3. The three roles

### Owner (web portal + Expo app, accent indigo #4F46E5)
- Create/lock/suspend retailers (login IDs, usernames, passwords via admin API,
  phone).
- Allocate credits and lock allowances.
- Credits = number of devices a retailer may manage. Consumed when an enrolment
  reaches ACTIVE; freed on de-enrolment/release; failed/expired sessions consume
  nothing; owner refills via ledger.
- Lock allowances = number of lock commands a retailer may execute (one per
  executed LOCK; refused/retried locks consume nothing); owner lock/release
  never consumes.
- Device board, audit trail, TOTP issue, device PIN set, enrolment QR page.

### Retailer (Expo app, accent teal #0D9488)
- Registers customers: name, phone, IMEI, brand/model (22-brand matrix), EMI
  months, EMI amount, EMI due day, and the customer's photo
  (`POST /api/retailer/customers/:id/photo` → private storage bucket; the
  retailer app shows its own local preview).
- Records payments (cash) into the payments table; summaries are DB truth.
- Brand-specific setup wizard (per-OEM steps).
- Generates download QR + provisioning QR + wireless option.
- Customer/device list with LOCK/UNLOCK (allowance-checked).
- Offline SMS LOCK/UNLOCK from the retailer's registered phone number (sender
  allowlist + customer code; DO gate; spoofing caveat documented).
- Offline unlock-code generator (Google Authenticator style): fetches the
  device's TOTP secret once (`POST /api/retailer/devices/:id/unlock-key`),
  caches it on the phone, and generates the same 8-digit codes the locked
  phone verifies — fully offline after the first fetch.

### Customer (Expo app, accent amber #D97706, launcher name "wifi")
- No login. Retailer registers the customer; the app binds with the setup code
  + a device token.
- Lock screen shows the customer photo (private Supabase Storage bucket,
  signed URL minted by the heartbeat, cached on the phone for offline use);
  reminders carry Bengali/Hindi voice + text. Honest note: Android
  notification images need a remote URL, so the photo appears on the lock
  screen the reminder opens, not inside the notification itself. Retailer
  contact, 112, and diagnostics are on the lock screen too.
- Hidden from the launcher after activation; unhidden on release.

## 4. The lock system (hard-lock-only; no soft lock anywhere)

- Command delivery is layered: an FCM/Expo wake-only kick (data-only payload,
  no command content) tells the phone to poll now; the heartbeat poll fetches
  the real command from Supabase; SMS works fully offline. Supabase stays the
  single source of truth — a forged push can at most trigger one poll, and a
  phone with no push token just rides the poll.
- Overdue escalation (K section): due day = 3 notifications at 10:00, 14:00,
  20:00 local (AUTOMATIC; the old −3/−1/+1/+3 automatic schedule is REMOVED —
  pre-due reminders are retailer-triggered only: the online REMIND command or
  the offline SMS `REMIND <code>`, a friendly bn/hi payment-reminder voice +
  notification, no allowance, refused on settled loans); overdue
  days 1–5 = every 30 min one notification + "EMI is overdue" spoken in
  Bengali then Hindi, 3 times per trigger, via app-level TTS (plays muted/DND;
  media volume maxed while overdue + DISALLOW_ADJUST_VOLUME, cleared on
  payment — honest limit: a hardware mute switch still cuts output). Day 3+
  without payment = GPS once per window (10:00–12:00, 18:00–20:00, stable
  random minute) and an SMS from the phone itself to the retailer's number
  with a Google Maps link (https://maps.google.com/?q=lat,lng) — uses the
  customer's SMS balance, documented; applies to notify_only plans too.
  Kill-switch: `customers.overdue_escalation_enabled` (default true, audited
  toggle in the retailer console) stops the AUTOMATIC voice escalation AND the
  location SMS; a deliberate retailer action (REMIND/ALERT/LOCATION online or
  by SMS) still works with the switch off — retailer action beats the
  anti-harassment toggle, automatic escalation respects it. Retailer ALERT
  command: one-shot urgent bn+hi voice, no allowance, refused on settled
  loans. Offline + overdue 4 days (no server contact for 4 days while
  overdue, cached or computed from the IST due date) → the phone hard-locks
  itself locally ('overdue-offline-watchdog-4d'), lock plans only, NOT gated
  by the kill-switch (that toggle never disables locks); the 5-day
  no-internet watchdog remains the outer bound, and the settled-while-offline
  edge keeps the TOTP SMS unlock escape.
- LOCK refused everywhere (server, native, SMS, SIM, boot) unless live Device
  Owner (`isDeviceOwnerApp` + readback). Non-DO LOCK acks FAILED, never
  EXECUTED.
- Full lock set: kiosk (`setLockTaskPackages` + `startLockTask`) + HOME takeover
  + `lockNow` + `DISALLOW_OUTGOING_CALLS` (112 exempt, device-tested) +
  `setUninstallBlocked` + `DISALLOW_FACTORY_RESET` + `DISALLOW_SAFE_BOOT` +
  `DISALLOW_ADD_USER` + `DISALLOW_DEBUGGING_FEATURES` +
  `setUserControlDisabledPackages` + FRP `setFactoryResetProtectionPolicy`
  (env accounts; OS side unverifiable, reported honestly).
- Reboot ban: `setLockTaskFeatures` WITHOUT `LOCK_TASK_FEATURE_GLOBAL_ACTIONS`
  (defaults-ON trap; locked features = KEYGUARD + SYSTEM_INFO only, because
  NOTIFICATIONS requires HOME on Android) + REBOOT command refused while
  locked. Hardware hold/battery-pull is unblockable; boot re-locks.
- 2-min offline re-assert heartbeat (before any network call, `lastLockAssertAt`).
- Boot auto-lock (BOOT_COMPLETED + HOME takeover + cover; DO-gated).
- SIM sentinel: 30 s debounce on SIM absent; IMSI/ICCID baseline for swaps
  (may be null on some devices, documented); loan-state gate; never fires for
  COMPLETE/SETTLED.
- Unlock-wins watermark (elapsedRealtime vs server_now) + SUPERSEDED/EXPIRED/
  CANCELLED acks. Stale locks refuse.
- Device PIN: owner-set via portal (`/api/owner/devices/:id/pin`), stored as
  `pin_verify = sha256(pin + ":" + installation_id)`, offline-verifiable.
- Offline TOTP unlock (owner-issued, audited; secret encrypted at rest with
  AES-256-GCM in `web/lib/totpCrypto.ts`). The retailer app can fetch the same
  secret once (`/api/retailer/devices/:id/unlock-key`) and generate matching
  codes offline — the Authenticator-style retailer generator path.
- Screen PIN: `resetPassword()` is dead for Device Owner on Android 11+, so the
  feature is a force-PIN-change policy (quality + min length) only.
- Settled loans (COMPLETE/SETTLED) never re-lock, anywhere.
- Suspended retailer: no new sessions, commands refused, heartbeat serves no
  commands; devices stay owner-managed; customers not auto-locked.

## 5. Enrolment (two approaches; customer APK builds FIRST)

Preconditions (verified): factory-reset phone, no Google accounts, no secondary
users, no pre-existing passcode, no existing owner/admin.

(a) Provisioning QR (working today): portal QR page embeds
`PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME` +
`PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM` (SHA-256 of the signing cert,
from `eas credentials`) + `PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION`
(the APK link). Setup wizard 6 taps → scan → DPC downloads → Device Owner →
`onProfileProvisioningComplete` finalizes → activation only on the phone's own
`mode=device_owner` readback → app hides.

(b) Wireless-debugging self-pair (no PC; retailer phone = controller, customer
phone = target): the target app walks the customer through one overlay grant +
one accessibility toggle; the accessibility service auto-walks developer
options, enables wireless debugging (per-OEM matrix) and reads BOTH the
pairing dialog (pairing ip:port + 6-digit code) and the main screen's connect
ip:port — the pairing port and the connect port are DIFFERENT numbers on stock
Android (settings package only, 10-min expiry, cleared after). Staff type the
four values (ip, pairing port, code, connect port) into the retailer app's
"Wireless enrol" flow, which drives a bundled AOSP adb client (Termux
android-tools, Apache-2.0, source URL + sha256 + NOTICE recorded — the pairing
crypto is that vendored binary, honestly NOT a from-scratch Kotlin SPAKE2):
`adb pair` → `adb connect` → `pm grant` list → `appops SYSTEM_ALERT_WINDOW` →
`dpm set-device-owner` → `dpm list device-owners` readback (must contain the
component) → debug-off cleanup → disconnect. Each step reports
{ok, output, readback} honestly and stops on failure. The target then
continues the normal bind/activation (heartbeat, mode=device_owner readback,
hideSelf). Until the first device passes the walk, (a) stays the recommended
path.

OEM matrix (verified research, in `packages/shared/src/oemMatrix.ts` + Kotlin
`OemFingerprint.kt`): Samsung Auto Blocker off first · ColorOS/Transsion
permission monitoring off · Xiaomi MIUI-Optimization off + native notification
style · HONOR 3-toggle walkthrough · vivo no account for pairing · near-stock
nothing. A family is "certified" only after a real device passes the acceptance
walk.

## 6. Build order (customer APK first — retailer must not build before it)

1. `cd D:\emidost\apps\customer` → `eas login` (team account) →
   `eas build -p android --profile customer`
2. Copy APK URL + signing SHA → paste into the portal QR page.
3. Only then: `apps\retailer` → `eas build -p android --profile retailer`.
4. Owner: `apps\owner` on the personal account, `--profile owner`.
5. Upload the three APKs: `gh release create v1 <apk files>` in the landing repo
   (the landing download buttons point at those release assets).
Global EAS env (Expo dashboard → environment variables → global):
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_API_URL=https://emidost-pd8s.vercel.app`,
`EXPO_PUBLIC_FRP_ACCOUNTS=106892760455009935120`.

## 7. Design system (see docs/DESIGN_SPEC.md for the full spec)

- Tokens in `packages/shared/src/designTokens.ts` (color roles, gradients for
  rings/hero only, type ramp, 4px space, radius, motion durations/easings,
  reduced-motion helpers).
- Dark = locked, light = free. Per-role accents indigo/teal/amber.
- Status chips = dot + text (no icon inside). Three button variants. 40px table
  rows. Icons = Lucide with aria-labels; text leads.
- Signature animations (what ships, honest): lock engage breathing ring
  (no overshoot; reduced-motion = static emblem). The other spec items —
  unlock celebration (capped confetti), SIM alert (shake + 1Hz ripple),
  payment check draw + tick-up, enrolment rail delta, heartbeat ripple — are
  spec-only, not implemented in the apps. transform/opacity only; RN
  useNativeDriver; reduced-motion respected; ≤3 loops/screen.
- Copy rules (humanizer + no-ai-slop, enforced): sentence case, no em/en dashes,
  no staged openers, no one-line closers, no forced triads, verb-first buttons,
  concrete numbers with units, no "simply/just/seamlessly/critical". String
  sheets en/bn/hi in `packages/shared/src/copy.ts` + the spec.
- Forbidden: gradient buttons/glowing orbs, emoji headings, shimmer walls,
  cached/optimistic green, hidden consent, fake lock claims.

## 8. Checks that must stay green

- `npx tsc --noEmit -p web/tsconfig.json`
- `npx tsc --noEmit -p packages/shared/tsconfig.json`
- `npx tsc --noEmit -p packages/device-kit/tsconfig.json`
- `npx tsc --noEmit -p apps/customer/tsconfig.json`
- `npx tsc --noEmit -p apps/retailer/tsconfig.json`
- `npx tsc --noEmit -p apps/owner/tsconfig.json`
- `node --test packages/shared/src/*.test.mjs` (13/13: stale 9 + totp 4)
- Kotlin compiles only in EAS Gradle builds (no local JDK/SDK); a queued build
  is not a pass.

## 9. Honest gaps (do not claim these work)

- Wireless self-pair: implemented end-to-end in code via the bundled AOSP adb
  client (RUNPATH-patched Termux android-tools 37 + 56-lib closure, sha256
  recorded) — but NO physical device has run the walk yet, so the QR
  provisioning path stays the recommended path until per-OEM acceptance.
  The pairing crypto is the vendored binary, not a from-scratch Kotlin SPAKE2.
- Consent: direct at the counter (user decision); no blocking record; optional
  audit row only (consent API exists; no dedicated consent screen in the apps).
- Payments UI: web console customer page records payments + shows history and
  the schedule; the retailer app has an inline Record-payment row; the customer
  app has no payments screen (it does not pay in-app).
- Reminder scheduling (expo-notifications): the OLD automatic −3/−1/+1/+3
  day schedule is REMOVED (reminder control shift). What ships: automatic due
  day 3x (10:00/14:00/20:00) + the overdue escalation; pre-due reminders are
  retailer-triggered only (online REMIND command or SMS `REMIND <code>`,
  friendly bn/hi voice + notification).
- TOTP at-rest encryption: DONE — AES-256-GCM in `web/lib/totpCrypto.ts`
  (key from TOTP_ENC_KEY or the service key); the heartbeat decrypts
  server-side and delivers over TLS.
- No physical device has run the acceptance walk; per-family certification is
  empty.
- Deployment: portal live on Vercel; APK builds + releases not yet done (user
  runs eas login; retailer blocked until the customer APK exists).

## 10. Verification checklist (full)

See `docs/VERIFICATION_CHECKLIST.md` (sections A-H: enrolment, wireless spike,
FRP/protections, lock engine, release/settlement/suspension, identity/UX,
performance, acceptance walks) and `checksum.md` (the running ledger).
