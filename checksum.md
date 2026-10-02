# emidost verification ledger

Fresh project; started 2026-10-02. This file records what is implemented, what
passed checks, and what still needs credentials or a physical device. Nothing
here is a deployment record.

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
