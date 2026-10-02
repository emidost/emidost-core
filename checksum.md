# emidost verification ledger

Fresh project; started 2026-10-02. This file records what is implemented, what
passed checks, and what still needs credentials or a physical device. Nothing
here is a deployment record.

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
