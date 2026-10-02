# emidost verification ledger

Fresh project; started 2026-10-02. This file records what is implemented, what
passed checks, and what still needs credentials or a physical device. Nothing
here is a deployment record.

## 2026-10-03 design pass 2 (all installed skills; claude portal + codex apps)

- Skills: taste-skill v2 + redesign-skill + emilkowalski design-eng + no-ai-slop
  (headroom = compression proxy, not applicable). Dials: VARIANCE 4 · MOTION 3
  · DENSITY 4 (trust-first ops UI). Inter stays.
- Portal: unified 180ms interactive easing, 8px grid, actionable-only row
  hover, skip-to-content + focusable mains, branded 404, login Ink entrance
  band, audit/console skeletons + empty states. User rule applied: DIFFERENT
  premium color per section — Ink hero bands (dashboard/list pages), inverted
  Paper-2 console panels, Ink QR band; Ink/Paper/Paper-2/Ink-2 family only, no
  #fff/#000 anywhere.
- Apps: per-screen soft-tint header bands (owner indigoSoft, retailer tealSoft,
  customer amberSoft) over Paper content + Paper-2 cards (three visibly
  distinct surfaces per screen); LockedScreen stays on the Ink ramp.
  Pull-to-refresh + removeClippedSubviews on the four long lists; busy/disabled
  states across retailer quick actions + owner inline actions; photo avatar
  hairline ring; useCallback hot paths; explicit accessibility labels.
- Animation review (emilkowalski): lock-engage breathing ring PASS (only
  ambient loop, GPU-only, reduced-motion → static); unlock confetti, SIM
  shake, heartbeat ripple = honest absences — docs corrected to ship-only
  claims (DESIGN_SPEC §4 + CONTEXT §7).
- Checks: all 7 tsc surfaces 0 · tests 13/13 · next build 14 routes.

## 2026-10-03 overdue escalation wave — lead supplement (native half + 4-day rule)

- Codex native half landed: OverdueAlerter 30-min loop + bn/hi TTS x3 +
  volume max + DISALLOW_ADJUST_VOLUME (cleared on settlement); day-3+ location
  SMS windows (10:00-12:00, 18:00-20:00, seeded minute, maps link, SEND_SMS
  gated); ALERT dispatch native + JS + retailer quick-action button; due-day
  10:00/14:00/20:00 schedule; worker PATCH parity.
- 4-day offline-overdue rule (user delta): SyncStateStore.overdueOfflineLockDue
  + JS mirror — lock plan + outstanding + overdue >= 1 (server or local IST
  from the cached due date) + >= 4 days since sync → local hard lock
  'overdue-offline-watchdog-4d'; NOT gated by the kill-switch (that toggle
  stops alerts + location SMS, never locks); 5-day no-internet watchdog stays
  the outer bound; settled-while-offline residual documented with the TOTP SMS
  escape. Checklist K6 added.
- Checks after the wave: all 7 tsc surfaces 0 · tests 13/13 · next build
  14/14 (lead re-verified before commit).

## 2026-10-03 overdue escalation — server + SQL half

- Plan: `.review/escalation-plan.md` (lead decision from the user spec).
  Rules: due day 3 notifications at 10:00/14:00/20:00 local (surrounding days
  keep the −3/−1/+1/+3 reminders); overdue days 1–5 every 30 min a
  notification + "EMI is overdue" in bn then hi ×3 via app-level TTS (plays
  muted/DND; media volume maxed + DISALLOW_ADJUST_VOLUME while overdue,
  cleared on payment; hardware-mute honest limit); day 3+ GPS once per window
  (10:00–12:00, 18:00–20:00) + SMS with a Google Maps link from the phone
  itself (customer SMS balance, documented; notify_only included);
  kill-switch + ALERT command.
- **SQL (claude):** `0015_escalation.sql` adds
  `customers.overdue_escalation_enabled boolean not null default true` and the
  `ALERT` command_type enum value. All-in-one regenerated (header + 0015).
- **Web (claude):** commands.ts accepts ALERT (staff + suspension + tenant
  gates; NO allowance debit; refused on settled loans exactly like LOCK);
  new `PATCH /api/retailer/customers/:id/escalation`
  (`web/lib/apiHandlers/customerEscalation.ts`) toggles the kill-switch
  (staff-only + suspension + tenant gates, body { enabled: boolean }, audit
  `ESCALATION_TOGGLED`), wired into the catch-all router (PATCH method +
  params extraction); heartbeat delivers `escalation_enabled` (default true)
  with the other customer fields in the existing wave; retailerCustomers GET
  carries the column via select('*') automatically; console customer detail
  page gained the "Overdue escalation" toggle card (BellRing, busy state,
  caption "Stops the 30-minute voice alerts and the location SMS when
  overdue").
- Docs: checklist section K (K1–K5) + I1 now 0011–0015; CONTEXT.md §4
  escalation rules block; SETUP.md acceptance line; FUNCTION_REPORT rows
  (commands ALERT, customerEscalation PATCH, heartbeat escalation_enabled,
  reminders schedule); this entry.
- Checks: web tsc 0 · workers tsc 0 · `next build` exit 0.
- Native/app half (codex, next): due-day schedule, 30-min escalation loop +
  TTS + volume/DISALLOW_ADJUST_VOLUME, day-3 location SMS windows, ALERT
  dispatch, retailer quick action, copy.ts bn/hi voice lines.
- Edges (honest): ALERT shares the settled-loan refusal with LOCK (both use
  the same gate; UNLOCK/RELEASE stay open); the kill-switch takes effect on
  the phone's next heartbeat (up to one poll interval); location SMS needs a
  GPS fix and an SMS-capable SIM on the customer phone.

## 2026-10-03 customer photo — server + storage half

- Lead decision (user confirmed): the retailer attaches the customer's photo at
  registration; it shows on the phone's lock screen and accompanies reminders,
  cached on the phone for offline. Photos live in a PRIVATE Supabase Storage
  bucket; uploads go through an API route with the service role (no bucket
  policies); the heartbeat mints a signed URL; the phone caches the file
  (codex's app half).
- **SQL (claude):** `0014_customer_photos.sql` adds `customers.photo_path` and
  creates the private `customer-photos` bucket (`public=false`, on-conflict
  do-nothing) with deliberately NO storage policies. All-in-one regenerated.
- **Web (claude):** new `POST /api/retailer/customers/:id/photo`
  (`web/lib/apiHandlers/customerPhoto.ts`, wired into the catch-all router):
  retailer-staff only + suspension gate (403), tenant check (404), multipart
  field `photo`, mime ∈ {image/jpeg,image/png,image/webp} (400 otherwise), size
  ≤ 2 MB (413 with a clear message), upload to
  `customer-photos/{customerId}/{uuid}.{ext}` via the service role, then
  `customers.photo_path` update + `CUSTOMER_PHOTO_SET` audit row; returns
  `{ photo_path }` (never the URL — the retailer app shows its local preview).
  Heartbeat: `photo_url` in the response = service-role
  `createSignedUrl('customer-photos', path, 86400)`, minted inside the existing
  parallel wave only when a photo exists; storage failure → null (the photo is
  a UX nicety, never a lock dependency). retailerCustomers GET attaches the
  same 24 h `photo_url` per listed customer (per-item catch → null).
- Docs: CONTEXT.md customer + retailer bullets (private bucket, signed URL,
  offline cache; honest note that Android notification images need a remote
  URL, so the photo shows on the lock screen the reminder opens, not inside
  the notification), README customer line corrected the same way, checklist
  F4 added, SETUP §1 storage line, this entry.
- Checks: web tsc 0 · workers tsc 0 · `next build` exit 0.
- App half (codex, next): retailer photo picker at registration + preview;
  customer app fetches/caches the photo from the heartbeat `photo_url` and
  renders it on the lock screen; reminder screen shows it.
- Edge (honest): uploading a new photo leaves the old object in the bucket
  (no delete on replace yet) — harmless at 2 MB/photo scale, noted for a
  cleanup wave.

## 2026-10-03 FCM push layer (wake-only kick) — supabase/server half

- Design (lead decision): FCM/Expo push is a WAKE-ONLY accelerator. The payload
  is data-only `{ type: 'kick' }` with no command content; the phone fetches the
  real command via its authenticated heartbeat, so Supabase stays the single
  source of truth and a forged push can at most trigger one poll. Layered
  fallback: push → heartbeat poll → SMS.
- **SQL (claude):** `0013_fcm_tokens.sql` adds `devices.fcm_token` +
  `fcm_token_updated_at` and REVOKES SELECT on both from anon/authenticated
  (service role keeps access; staff SELECT policies are table-level, so the
  revoke closes the columns for them too). All-in-one regenerated (header +
  appended 0013).
- **Web (claude):** `web/lib/fcm.ts` `sendKick` POSTs to Expo Push Service
  (`https://exp.host/--/api/v2/push/send`) with `[{ to, ttl: 60, priority:
  'high', data: { type: 'kick' } }]`, 5 s AbortController timeout, never
  throws (returns { ok, error }), optional `EXPO_PUSH_ACCESS_TOKEN` header
  (added to web/.env.example as optional — default tier needs none). register
  accepts an optional `fcm_token` (string ≤ 200 chars) and stores it with
  updated_at on the upsert; heartbeat rotates/clears it inside the existing
  parallel update wave (no extra round trip; `fcm_token: null` clears).
  commands.ts + commandProxy.ts fire the kick after the command insert without
  blocking (sendKick never throws; failures logged with the device id) and
  record `push_kick: 'attempted'|'skipped'` in the audit detail. ack.ts RELEASE
  clears fcm_token + updated_at (a released phone never receives kicks).
  Explicit device column lists (retailerDevices + both device pages) already
  exclude the new columns — verified, no change needed.
- **App side (codex, next):** customer app registers the Expo push token (or
  skips cleanly without Play Services) and a data-only kick listener triggers
  one poll; nothing else changes — polling and SMS are the fallbacks.
- Docs: CONTEXT.md §2 + §4 (layer, source-of-truth rule), SETUP.md "Push
  (optional)" section, checklist section J (J1-J4 CODE, J5 DEVICE).
- Checks: web tsc 0 · workers tsc 0 · `next build` exit 0.
- Honest edge (stated): Expo data-only messages have no guaranteed background
  wake on every OEM; a data-only `{type:'kick'}` may be delivered with delay or
  never on aggressively battery-managed devices — that is exactly why the poll
  and SMS layers stay in place and why no command content ever rides in the
  push. Real wake latency is J5 (DEVICE).

## 2026-10-03 premium design wave (claude web + codex apps + lead landing)

- Design rules applied: biswodip-design-review pipeline + taste-skill + no-ai-slop;
  agent-reach installed at .biswodip/upstream/agent-reach (content tooling).
- Palette: Ink #0F141C / Paper #F4F1EA ramps everywhere (no pure white or pure
  black anywhere: portal, three apps, native overlay, landing). Role accents
  unchanged (indigo/teal/amber are the product identity). Hairlines, focus
  rings, 44px targets, reduced-motion respected, shimmer/gradients removed.
- Portal: 12 pages premium cards, icons on every control, skeleton loading +
  empty states, verb-first labels, zero banned words/em dashes.
- Apps: shared designTokens gains ink/paper ramps + soft tints; customer lock
  screen on Ink; retailer device quick-action row; owner busy guard; icons +
  accessibilityLabels everywhere; zero raw white/black hexes in the apps.
- Native overlay cover aligned to the Ink ramp (#161D29 / #F4F1EA).
- Landing (D:\emidost2, pushed to github.com/emidost/emidost): full redesign —
  Ink hero with the real locked-screen mockup + owner portal mockup, three
  role cards, honest certification wording (per-family walk before "working"),
  fabricated testimonial removed, 3 download cards (owner/retailer/customer),
  Sora/Inter fonts, lucide icons; builds exit 0.
- Checks: web/shared/device-kit/customer/retailer/owner/workers tsc 0 · tests
  13/13 · next build 14/14 · landing build 0.

## 2026-10-03 final fix sweep (claude web/SQL/docs + codex native)

- `commands.ts` compensation: when the `lock_consumed` ledger insert fails AFTER
  a successful allowance debit, the allowance is refunded (`increment_allowance`
  + best-effort `lock_refund` row), the command is CANCELLED, and the failure is
  audited (`COMMAND_CANCELLED`). Closes the "unrecovered debit" residual.
- `ownerRetailers.ts` rollback deletes are no longer silent: `console.error`
  on failure, best-effort semantics kept.
- `web/app/page.tsx` claims self-heal: an owner/staff account whose
  app_metadata lacks the matching role (or retailer_id) claim gets it backfilled
  merge-safe via `auth.admin.updateUserById` on the next portal visit, logged,
  then re-read — closes the "manual-account sees zeros" residual.
- REBOOT end-to-end: `commandProxy` accepts REBOOT (owner-only; retailer
  commands route untouched), the owner devices board gains a REBOOT button, and
  new migration `0012_reboot_command.sql` adds the command_type enum value
  (all-in-one regenerated). Native semantics (codex): `rebootDevice` schedules
  the reboot ~5 s out so the EXECUTED ack lands first; refusal while locked is
  unchanged, reason `locked_reboot_refused`.
- `docs/FUNCTION_REPORT.md` refreshed to commit `5bd8a8b`: wireless self-pair
  rows rewritten (EmidostAdbBridge = bundled AOSP adb step runner, CODE +
  DEVICE; accessibility service captures pairing + connect port; new
  PairingWalkthrough + WirelessEnrol entries; command service row gains SMS 60 s
  debounce + simBaselinePresent + REBOOT dispatch), unlockWithCode lag residual
  marked FIXED (heartbeat `locked` write), commands/commandProxy residuals
  updated, threat tables updated (spoof-SMS DoS now debounced, portal indicator
  fixed, new wireless-pairing row), honest-limits rewritten (0011+0012 pending,
  REBOOT wording, self-pair no longer a skeleton), checklist D4 updated.
- Fixed-vs-honest split: FIXED in code = allowance compensation, rollback
  observability, claims self-heal, REBOOT end-to-end (command level), portal
  lock-indicator lag. HONEST remaining = 0011+0012 not yet applied live,
  worker redeploy, EAS builds, per-OEM walks (QR + wireless), FRP/user-control
  OS readback, FGS cap, in-memory limiter.
- Checks: web tsc 0 · workers tsc 0 · `next build` exit 0 (re-verified).

## 2026-10-03 function report (lead + claude + codex)

- Claim-by-claim report published at `docs/FUNCTION_REPORT.md`: 113 functions
  (39 web/API/SQL + 74 apps/native/shared/worker), each with Claim / How it
  works (file refs) / What it prevents / Status, plus two threat tables
  (15 + 12 abuse vectors → blocking function → honest residual), verification
  evidence, honest limits, and standing user actions. Drafts kept in
  `.review/`.

## 2026-10-03 wireless-debugging self-pair (no PC) — bundled adb decision

- Plan reference: `.review/wireless-plan.md` (lead decision). Reality check
  accepted: Android exposes no TLS 1.3 PSK/SPAKE2 mode, so a from-scratch
  Kotlin SPAKE2 would need embedded BoringSSL. Instead the retailer app drives
  a VENDORED AOSP adb client (Termux `android-tools`, Apache-2.0; source URL +
  sha256 + NOTICE recorded by the lead before vendoring) — the checklist now
  honestly says "bundled AOSP adb client", not "Kotlin SPAKE2".
- Flow: target app = overlay grant + accessibility toggle + wireless-debugging
  walk + pairing-code read (settings only, 10-min, cleared); retailer app =
  staff-typed host/port/code → `adb pair` → `connect` → `pm grant` ×8 →
  `appops SYSTEM_ALERT_WINDOW` → `dpm set-device-owner` → `dpm list
  device-owners` readback → debug-off cleanup → disconnect; then the normal
  bind/activation (heartbeat, mode readback, hideSelf). QR path (A) remains
  the documented alternative until a device passes the walk.
- Threat-residual fixes decided: (1) heartbeat lock-state write (below);
  (2) SMS LOCK same-customer 60 s debounce; (3) `simBaselinePresent` status
  readback; (4) 5-day watchdog KEPT (business decision; settled-loan offline
  residual stays documented with the TOTP SMS escape); (5) hardware-hold
  reboot, FRP OS readback, A12+ user-control, FGS cap and in-memory limiter
  stay honest documented residuals.
- **Web (claude):** heartbeat accepts optional `locked` (device enforcedLocked
  readback): `true` → `devices.is_locked = true`; `false` → clear ONLY when no
  LOCK/DEVICE_ACTION is PENDING/RECEIVED for the device (no extra query — the
  pending load already returns command_type); settled loans skip the write so
  a paid-off phone can never read "Locked" server-side.
- **Native/app (codex):** EmidostAdbBridge step runner, asset + manifest
  wiring, pairing walkthrough screen, retailer wireless-enrol flow, SMS
  debounce, status additions. Lead fetches/verifies the binaries.
- Docs: CONTEXT §5(b) rewritten, SETUP §6 wireless walk, checklist B2/B3/B5 +
  H8 now CODE + DEVICE.
- Checks: web tsc 0 · `next build` exit 0 (re-verified after the heartbeat
  change). DEVICE walks pending (vivo first).

## 2026-10-03 offline unlock — retailer Authenticator-style TOTP generator

- Design contract: `.review/offline-unlock-plan.md`. The phone already verifies
  RFC 6238 TOTP locally (Totp.kt: HMAC-SHA1, 8 digits, 30 s, ±1 window, base64
  secret) behind the hidden long-press entry; the secret reaches the phone via
  the heartbeat (`totp_secrets.secret_enc`, decrypted server-side).
- **Web (claude):** new `POST /api/retailer/devices/:id/unlock-key`
  (`web/lib/apiHandlers/retailerUnlockKey.ts`, wired into the catch-all API
  router). Retailer-staff only (403 otherwise, 403 when suspended), device
  must belong to the retailer (404 otherwise). Returns the SAME base64 secret
  the device stores (`{ secret, period: 30, digits: 8 }`). No secret yet → 409
  `no_unlock_key` (never minted here — a fresh secret could never reach an
  offline phone). Decrypt failure → 500. Every issue writes
  `audit_log.TOTP_KEY_ISSUED_RETAILER`.
- **App side (codex, in progress):** shared `packages/shared/src/totp.ts`
  mirroring Totp.kt + tests; retailer app fetches once online, caches in
  expo-secure-store, generates codes offline (countdown ring, copy button);
  worker dispatch parity line.
- Docs: CONTEXT.md retailer bullet + §4 TOTP line, SETUP.md §5, checklist D11.
- Checks: web tsc 0 · `next build` exit 0 (re-verified after the feature).

## 2026-10-03 CLI audit wave 2 + hardening (claude web/SQL/docs + codex apps/native)

- **Live-DB probe (lead, read-only): the database is ALREADY fully migrated.**
  All 10 tables (incl. `rate_limits`), `customers.lock_mode`, the LOCATION
  command enum, and the RPCs (`record_payment`, `rate_limit_hit`,
  `consume/refund/release_device_credit`, `adjust_credits`) are present, and
  anon probes against `devices`/`payments` return `[]` (RLS works). The earlier
  "USER STILL MUST RUN IT" note was stale — the DB was applied; only the ledger
  said otherwise. Portal https://emidost-pd8s.vercel.app responds 200.
- **SQL (claude):** new `0011_rate_limits_rls.sql` closes the `rate_limits`
  table (RLS enabled + public execute revoked on `rate_limit_hit`, service_role
  only) — 0009 had shipped it wide open. `0005_rls_jwt.sql` tightened: staff are
  SELECT-only on customers/devices/payments/emi_schedules (all mutations via
  the API/RPCs), and every staff branch re-checks the live profiles row for
  suspension (own row via profiles_self, no recursion). `0010` `record_payment`
  now REJECTS overpayments (exception 'overpayment'). Stale 0001 comment
  corrected; all-in-one regenerated (11 migrations) and includes 0011.
- **Web (claude):** retailer-create route writes the JWT `app_metadata` claims
  (role/retailer_id + provider/providers, merge-safe) so RLS works for
  portal-created retailers; `create_accounts.mjs` mirrors the merge. Device
  pages use explicit column lists (no `pin_verify`/`device_token_hash`/
  `device_pin_hash`/SIM baselines in the browser). register blocks cross-
  customer re-pointing of an active device (settled devices may be
  re-enrolled). Heartbeat: activation also covers `created` sessions, a 24 h
  lazy sweeper expires stuck PENDING/RECEIVED commands and refunds LOCK
  allowances once, `overdue_days` parses due dates in Asia/Calcutta, and the
  response now includes `is_locked`. Ack route writes an ack row for the
  settled-loan supersede path. Payments route maps overpayment to 400. Due-day
  math is IST-based in the customer-create route and the owner dashboard.
  New retailer console customers list page + nav link (payments UI is now
  reachable); ignored `force-dynamic` exports removed from client pages;
  ownerCredits returns 404 for a missing retailer.
- **Docs:** SETUP.md §1 now says run `0000_all_in_one.sql` in a NEW query tab
  then `node scripts/create_accounts.mjs` (no manual owner SQL); §5 SMS syntax
  = `LOCK <customer-code>`, `UNLOCK <customer-code> <totp>`. CONTEXT §9 gaps
  corrected (TOTP encryption done, reminders wired, payments UI exists).
  Checklist: D11 at-rest encryption done, F3 payments UI CODE, C4 A12+
  user-control caveat, E1 5-day-watchdog honesty note, G-section rate-limiter
  note. BUILD_AND_DEPLOY_STEPS: 11 migrations + canonical API URL
  https://emidost-pd8s.vercel.app. Root `package.json` typecheck now covers
  web/shared/device-kit/customer/retailer/owner/workers (landing is a separate
  repo: `tsc` inside `D:\emidost2` manually) + `npm run verify`.
- **Checks:** web/shared/device-kit/customer/retailer/owner/workers tsc 0 ·
  shared tests 9/9 · `next build` exit 0 (re-verified after all edits).
- **Remaining USER actions:** (1) run `0011_rate_limits_rls.sql` (or the
  regenerated all-in-one) in a NEW query tab on the live DB — RLS on
  `rate_limits` is the one hardening piece not yet live; (2) EAS builds +
  GitHub APK release; (3) per-family device acceptance walks. WAF/Upstash
  rate-limit rule remains a scale item; the in-memory limiter is per-instance
  and the shared limiter fails open (both documented).
- **Apps/native (codex):** kiosk pinning now actually engages —
  `enterLockTask`/`exitLockTask` exported and called from the customer app on
  locked state + LockedScreen mount (A8/D1/D3 had a dead call before). The JS
  LOCK path now runs the unlock-wins watermark (`serverNow − elapsedDelta`,
  rewritten `stale.ts`, 9/9 tests) and acks SUPERSEDED instead of executing a
  stale lock (D8 on both paths). `notify_only` plans can no longer be
  hard-locked by the SIM sentinel or SMS LOCK (lock_mode gate). Config plugin
  airplane-mode action fixed (`AIRPLANE_MODE_CHANGED`). Hidden long-press
  PIN/TOTP entry on the lock screen wired to the native verifiers + local
  unlock (a11y docblock now describes the real behavior). Library manifest
  drops ACCESS_BACKGROUND_LOCATION; FRP id placeholderized in
  `.env.example` files. `HeartbeatResponse` fully typed (`pollOnce` has no
  `any`); retailer Enrol tab follows the chosen customer brand; `lock_mode` in
  the createCustomer type. FGS start failures logged with honest A15 dataSync
  notes; API-24-safe `DpcContext` wrapper at all device-protected-storage call
  sites + `rebootDevice` guard; `FinancingProtection.status()` reports
  `user_control_attempted` honestly.
- **Final polish (codex + lead):** G3 done — retailer Customers/Devices and
  owner Retailers/Audit lists are FlatLists (empty states kept; audit gained
  one). Checklist evidence refreshed (A8/D8/D10/D11 wiring, G1/G3, I1 live-DB
  truth). Worker guide reconciled: Vercel API is the canonical app URL; the
  Worker reuses web handlers so a `wrangler deploy` picks up all of today's
  fixes. Local PIN/TOTP unlock updates the device immediately; the portal lock
  indicator follows the next command ack/heartbeat (documented, D11).
- **Final checks (lead, after all edits):** `npm run verify` PASS (7 tsc
  surfaces + 9/9 tests) · `next build` PASS (14/14 pages) · landing tsc PASS ·
  pushed as 2b648a8 + 9c22a17. Live re-probe: portal 200; DB still pre-0011
  (expected — user action 1 above).

## 2026-10-02 claim-sweep fixes (push b5cb2b8)

- Atomic ack CAS (PENDING/RECEIVED only) + terminal immutability; allowance refund on FAILED/EXPIRED locks; RELEASE refunds device credit once; activation consumes a credit once (session-state CAS) — `0008_allowance_refund.sql` RPCs.
- Stable TOTP secret (rotate=1 to mint a new one) so offline codes keep verifying.
- SIM debounce re-reads live SIM state at fire time; kiosk live readback (kioskActive in status).
- Owner app busy + NaN guards; customer diagnostics hidden behind three taps.
- All checks green (8 tsc surfaces + tests); worker redeployed. All-in-one now 8 migrations; USER STILL MUST RUN IT (DB lacks lock_mode per live probe). RESOLVED 2026-10-03: a live probe confirmed the DB was in fact fully migrated; see the top entry.
- Remaining user actions: run the SQL, WAF/Upstash rate-limit rule (dashboard), build customer APK + GitHub release for landing links.

## 2026-10-02 improvement arena (3 auditors + design arena, push cf921b8 / b1258b3)

Fixed now:
- Kotlin build blockers (would have failed EAS Gradle): SMS `?: continue` rewrite, UserManager→DPM add/clearUserRestriction, `FactoryResetProtectionPolicy.Builder()` (no DPM helper exists), module `appContext.reactContext` non-null, OemFingerprint List<Intent> signature, onTimeout override removed (compileSdk 34).
- Unlock watermark math: `unlockAtServerTime = serverNow - elapsedDelta` (was device-wall-based; fresh LOCK after unlock wrongly marked stale).
- Payments allocate against `amount_due - amount_paid` (partials no longer overwrite).
- Bearer-token auth parity in web/lib/auth.ts (apps can hit the Vercel fallback); wrangler `compatibility_flags = ["nodejs_compat"]`.
- Retailer add-customer + record-payment busy guards (no double submits).
- Portal dashboard: undefined CSS vars (--textHi/--line/--teal → --text-hi/--border/--accent-teal), flat stat icons, verb-first title.
- Customer offline cache shape (due date string + amount) fixed.
- Landing SEO pass by Claude: metadata/OG/twitter, canonical, sitemap/robots repoint, favicon, keyword H1s, WhatsApp deep-link CTA. tsc 0, deployed to Pages.

Honest deferred (next wave; some need EAS/device): native mirror of the 5-day watchdog + separate local reassert timer, credit activation/release lifecycle, atomic ack transitions + allowance reservation, stable offline TOTP provisioning, SIM debounce re-read + ICCID compare, kiosk lock-task verification, docs understate updates. All recorded, none faked.

## 2026-10-02 offline + lock-mode wave (push 4dec110)

- `0007_offline_lock.sql`: `customers.lock_mode` ('lock' | 'notify_only', default lock) + index. All-in-one rebuilt (7 migrations).
- Heartbeat now delivers lock_mode, emi_amount/months/due_day, retailer_name - the phone's full offline copy.
- Customer app: caches the whole server state locally; falls back to it when offline; 5-day no-internet watchdog hard-locks locally (lock plans only; notify_only never locks, reminders only). SMS path untouched.
- Retailer app + web console: "Phone lock plan" choice at customer creation; cards show the plan chip.
- Owner portal dashboard redesigned: gradient stat cards with sheen hover, animated 4-step guide, quick actions, honest note; reduced-motion safe.
- Worker redeployed (heartbeat fields live). Checks: web/shared/device-kit/customer/retailer/owner/workers tsc 0, tests 6/6.
- User action: run the single 0000_all_in_one.sql in a NEW query tab.

## 2026-10-02 security + SQL hardening wave (Claude + Codex audit, auto-approved)

Both CLI agents audited (17 + 31 findings, merged). Implemented (push a6a6302):
- SQL `0003_hardening.sql`: actor helpers → SECURITY DEFINER, `adjust_credits` atomic RPC, `emi_schedules.amount_paid`, 5 new indexes, positive-amount + non-negative-balance constraints. All-in-one regenerated to include hardening; published-password seed file removed (accounts = admin API script only). CORRECTION (2026-10-03): the SECURITY DEFINER helpers were later REMOVED by `0005_rls_jwt.sql` — the final RLS reads role/retailer_id from the JWT `app_metadata` claim (written by the admin API), and suspension is enforced live at the route level, not inside RLS.
- Web: enrolment token consumed atomically (state created→installed, no replay/repointing); register checks retailer suspension + rejects settled-loan re-enrolment; heartbeat no longer trusts client `mode` for owner promotion (open session required) and keeps UNLOCK/RELEASE flowing when the retailer is suspended; allowance debit moved AFTER command insert (rollback on failure); UNLOCK allowed on settled loans; payments rejected on settled loans + `amount_paid` allocation; customer creation generates the full repayment schedule (with rollback on failure); retailer creation upserts the staff profile (new auth schema has no trigger); rate limiting on register/heartbeat/ack (in-memory, 429); TOTP key throws in production when unset.
- Mobile: device tokens via expo-crypto CSPRNG (no Math.random); SIM baseline set exactly once (replacement SIM can't silently become baseline); SIM receiver validates actions + locks only on confirmed ABSENT (UNKNOWN no longer false-locks); SMS UNLOCK now requires a valid TOTP as the authenticated factor; lock overlay gains an Emergency 112 button; LockPolicies missing ComponentName/Intent imports fixed.
- Verified: web/shared/device-kit/customer/retailer/owner tsc all 0 · stale tests 6/6.
- Remaining honest notes: per-IP rate limiter is in-memory (swap for Upstash at scale); SPAKE2 spike, device acceptance, Kotlin EAS compile still pending (documented elsewhere).

## 2026-10-02 fix wave (plan-robustly-then-fix)

- **Landing design pass applied** (spec §5-6): headline "Sell phones on EMI. Get paid on time.", trust section with 3 clearly-marked-for-replacement quotes + verifiable strip, locked→paid hero cycle (6s CSS, reduced-motion off). Pushed to the landing repo.
- **Payments UI**: web customer detail page (record + history + schedule) + retailer app inline "Record payment" row; GET endpoints for payments + schedules.
- **Reminder scheduling**: expo-notifications channel + −3/−1/0/+1/+3 dates from heartbeat `next_due`, replaced each poll, cancelled on COMPLETE/SETTLED.
- **TOTP at-rest encryption**: AES-256-GCM (`web/lib/totpCrypto.ts`, key from TOTP_ENC_KEY or service key), heartbeat decrypts server-side and delivers over TLS.
- Checks: web/shared/device-kit/customer/retailer/owner tsc all 0 · landing tsc 0 · stale tests 6/6. Stray bak file removed (7131eeb).

## 2026-10-02 accounts wiring

- GitHub: private repo created + pushed — https://github.com/emidost/emidost (commits b95a384 initial, 50e142e Supabase wiring). Git credential via the provided token; recommend rotating it after setup.
- Supabase: project ref `fhmndtznwtchqrfuobyq` wired into `.mcp.json` (Claude Code project MCP, committed) and into all four `.env.example` URLs. Anon + service_role keys still required. `claude /mcp` authentication is the user's terminal step.
- Consent: removed as a blocking precondition (direct counter consent is the business rule); enrolment + QR generate without a consent record; optional audit row remains possible.

## 2026-10-02 system review + full verification checklist

- Confirmed in code, with evidence: **kiosk install (Device Owner) = implemented** (QR with DPC + signature checksum → `onProfileProvisioningComplete` → `setLockTaskPackages` + HOME takeover + `startLockTask`; activation only on the phone's own `mode=device_owner` readback). **Wireless-debugging self-pair = NOT implemented** (honest skeleton: `EmidostAdbBridge` reports `implemented=false`; SPAKE2 is the Stage-1 spike; the QR path is the working fallback). **FRP = wired end-to-end** (env-only `EXPO_PUBLIC_FRP_ACCOUNTS` → heartbeat → `setFactoryResetProtectionPolicy` at activation + boot restore; OS-side application is unverifiable until a device, reported as `frp_os_confirmed=false`).
- Full checklist written to `docs/VERIFICATION_CHECKLIST.md`: sections A (QR enrolment), B (wireless self-pair, marked SPIKE), C (FRP + protections), D (hard-lock engine), E (release/settlement/suspension), F (identity/UX), G (performance), H (per-OEM acceptance walks), I (deployment gates). Every item carries CODE / DEVICE / CRED / SPIKE / Follow-up state.

## 2026-10-02 CLI double-audit (Claude Code + Codex) + performance pass

- **Verification by two CLI agents** (both run on this machine, read-only prompts): Claude Code verdict = all goal items PASS, with a performance plan (11 indexes + heartbeat round-trip collapse + double-poll dedupe). Codex verdict = found P0 integrity gaps, all fixed below.
- **Codex findings fixed:** truthful acks (LOCK acks FAILED without live Device Owner; native service returns enforcement result) · boot overlay + module `lockNow` gated on Device Owner · kiosk flags corrected (NOTIFICATIONS needs HOME on Android; locked features now KEYGUARD+SYSTEM_INFO only) + `enterLockTask` native function · settled loans: JS unlocks + clears sentinel + stops commands; SMS LOCK gated on loan outstanding; SIM callback re-checks the loan at fire time · accessibility pairing read restricted to com.android.settings + 10-min session expiry + bridge values cleared · steering stops at release (loan-state gated) · FRP status reports requested/missing/OS-unconfirmed honestly (no fake "applied") · heartbeat `policies` no longer all-true; device-reported `mode` drives enrolment ACTIVE · retailer suspension gates heartbeat (commands empty when suspended) · RELEASE flips device state only on EXECUTED ack · payments mark the loan COMPLETE + release event when nothing remains · device-admin capabilities trimmed to force-lock + limit-password only.
- **Performance applied:** `supabase/migrations/0002_perf_indexes.sql` (13 indexes incl. device_commands(device_id,status,created_at), emi_schedules(customer_id,due_date), unique enrollment token_hash, unique customers(retailer_id,imei), audit/ledger/payments/consent paths) · heartbeat parallelized (6 sequential calls → 2 waves; update+reads in Promise.all) · single-flight app loop (no overlapping slow rounds) · FRP/PIN/TOTP/SMS config consumed each poll (no duplicate DPM churn when unchanged values are idempotent writes).
- Checks after the wave: web/shared/device-kit/customer/retailer/owner tsc all 0 · stale tests 6/6.
- Remaining perf polish noted for later: FlatList virtualization in retailer/owner lists, native poll pause while foregrounded, TOTP at-rest encryption.

## 2026-10-02 initial build + review pass

### Implemented
- Root scaffold (npm workspaces), README, SETUP.md (account-dependent steps), .gitignore, per-app .env.example (placeholders only, no secrets).
- `supabase/migrations/0001_schema.sql`: 14 tables (profiles, retailers, credit_ledger, customers, devices, payments, emi_schedules, device_commands + acks, enrollment_sessions, consent_records, audit_log, totp_secrets, release_events, pins folded into devices), RLS tenant chain on retailer_id, SECURITY DEFINER role+retailer_id trigger, atomic decrement_allowance RPC, idempotent guards.
- `packages/shared`: types, API client, verified OEM matrix (22 brands + platform facts), copy rules (humanizer + no-ai-slop), unlock-wins staleness logic + 6 node tests.
- `web/`: owner portal (dashboard, retailers + suspend + credits + allowances, devices, enrolment QR with consent gate + signature checksum, audit), retailer console (customers/new, devices), API routes (owner retailers/credits/allowances/audit/totp/pin, retailer customers/consent/enrollment/payments/devices/commands, device register/heartbeat/ack). Hard-lock-only server gates; settled loans refuse LOCK; suspension re-checked live per request.
- `packages/device-kit`: Expo module + config plugin (receiver, a11y service, FGS, SMS/SIM/boot receivers, OEM queries); Kotlin: hard-lock-only module (refuses without Device Owner), LockPolicies (kiosk + HOME takeover + call block + explicit lock-task features WITHOUT GLOBAL_ACTIONS), FinancingProtection (uninstall/factory-reset/safe-boot/add-user/debugging/clock blocks + FRP via env accounts), boot receiver, START_STICKY command service with offline-first 2-min re-assert + Android 15 onTimeout, SMS LOCK/UNLOCK (retailer allowlist + customer code), SIM sentinel (30 s debounce + IMSI/ICCID baseline + loan gate), overlay, accessibility service (consent-based; transient pairing-window read; PIN gate), OemFingerprint (Kotlin), Totp (offline verify), ADB self-pair skeleton marked unimplemented (Stage-1 spike).
- `apps/customer`: named "wifi"; bind via enrolment token; heartbeat poll; hard lock + locked screen (112, retailer call, voice); device PIN verify; TOTP secret; SIM baseline; hide-from-launcher after activation, unhide on release; reminders copy bn/hi/en.
- `apps/retailer`: login, customer register (all 7+ fields), device list + LOCK/UNLOCK (allowance-checked server-side), enrol walkthrough (OEM steps).
- `apps/owner`: login, retailers list + suspend + credits + allowances + create, audit.

### Checks
- web tsc 0 · shared tsc 0 · device-kit tsc 0 · customer tsc 0 · retailer tsc 0 · owner tsc 0 · stale tests 6/6.
- Review sub-agent passed the implementation against the agreed plan; its findings were fixed: devices_owner_write tenant hole, payments/schedules tenant predicates, app_metadata retailer_id sync, FRP env-only (no hard-coded fallback), service-role retailer creation, register takeover guard, PIN pin_verify format, TOTP secret delivery via heartbeat, SIM baseline wiring, hideSelf wiring, reminder.wav asset, notification builder minSdk guard, migration idempotency.

### Honest gaps (reported, not hidden)
- Kotlin is NOT compiled locally (no JDK/SDK here): Gradle compilation is an EAS-build step and remains unrun.
- SPAKE2 self-pair: skeleton only, marked unimplemented; enrolment via provisioning QR until the Stage-1 device spike.
- Consent recording: API exists; no UI yet (web QR checkbox is cosmetic until wired to a consent row).
- Payments: API exists; retailer app/web UI for recording payments not yet built.
- Reminders: copy + voice hooks present; expo-notifications scheduling not yet wired.
- TOTP at-rest encryption is a hardening TODO (service-role column only).
- No physical device has run the acceptance walk; per-family certification is empty.
- Credentials (Supabase, EAS, SMS provider) not provided; nothing deployed.

### Next (needs user)
1. Provide Supabase + EAS accounts → run migration, set envs, first EAS builds.
2. Stage-1 vivo spike (SPAKE2 pairing) or QR-provisioning acceptance first.
3. Wire consent + payments UI; schedule reminders.
4. Per-family acceptance walks recorded here.
