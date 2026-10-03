# Retailer release, lock policy, and remote levers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make device locking retailer-controlled (opt-in auto-lock per customer, explicit release after payoff) and add owner+retailer remote levers — set exact phone PIN, reminder wallpaper, and SIM info — usable online and over SMS.

**Architecture:** Extend the existing command pattern (command_type enum value → web route gate → `device_commands.payload` → heartbeat delivery → native dispatch → app UI; plus an SMS form). One SQL migration (0019) adds three enum values and two columns. The lock engine reads a new per-customer flag to gate all automatic locks. Release/credit-free moves off payment-completion onto the explicit RELEASE path.

**Tech Stack:** Next.js API routes (web + workers parity), Supabase Postgres + RLS, Expo/React Native (apps), Kotlin Device Admin/Owner (packages/device-kit), node:test for shared units, `scripts/acceptance_ab.mjs` for server acceptance.

**Spec:** `docs/superpowers/specs/2026-10-03-retailer-release-lock-policy-remote-levers-design.md`

## Global Constraints

- Hard-lock-only; the phone never fakes a result — every native action returns a real `{ok, reason}` readback; FAILED acks when it cannot enforce. (spec §1)
- `packages/shared` stays DOM-free (RN lib ES2020) — no browser globals in shared code. ([[shared-package-dom-safety]])
- New command types carry NO allowance debit and are tenant + suspension gated; owner + retailer may send them. (spec §3.2–3.4)
- SMS commands reuse the existing sender-allowlist + customer-code gate + per-command debounce; SMS is spoofable (documented), especially `SETPIN`. (spec §6)
- Migrations are idempotent and also folded into `0000_all_in_one.sql`. (repo convention)
- Copy strings go in `packages/shared/src/copy.ts` with bn/hi/en; sentence case, no banned words/em dashes. (spec §5, CONTEXT §7)
- All 7 tsc surfaces + `node --test packages/shared/src/*.test.mjs` + `next build` must stay green before any commit. (CONTEXT §8)
- Keystore unchanged across the rebuild → QR signing-SHA stays `2efd2678aa9d16cc01e13f9f108a8dd2d6d3c93ab692f02e807f6053be36466f`. (spec §7)

## Review Focus

- **No-EMI-record customer create** with EMI fields omitted must succeed (today they are required) and set `auto_lock_on_overdue=false`; a reasonable retailer omitting EMI must not get a 400. → tested in Task 3.
- **Final payment** must mark COMPLETE **without** freeing the credit or releasing; a reviewer expects the device still managed until RELEASE. → tested in Task 4.
- **RELEASE** must be the only path that frees the device credit (exactly once) and unhides. → tested in Task 4.
- **New commands with a missing/oversized payload** (e.g. `SET_DEVICE_PIN` with no `pin`, or a 1000-char pin) must be rejected with 400, not queued. → tested in Task 5.
- **auto_lock_on_overdue=false** must suppress the 4-day/5-day/SIM automatic locks in the shared decision helper while leaving manual LOCK untouched. → tested in Task 7.

---

### Task 1: Migration 0019 + all-in-one regen

**Files:**
- Create: `supabase/migrations/0019_lock_policy_remote_levers.sql`
- Modify: `supabase/migrations/0000_all_in_one.sql` (append header note + 0019 body)
- Modify: `supabase/migrations/0001_schema.sql` only if `customers.emi_*` are `not null` — relax to nullable there is NOT allowed (keep 0001 historical); instead 0019 does `alter column ... drop not null`.

**Interfaces:**
- Produces: enum values `SET_DEVICE_PIN`, `SET_WALLPAPER`, `GET_SIM`; `customers.auto_lock_on_overdue boolean not null default false`; `customers.emi_amount/emi_months/emi_due_day` nullable; `devices.sim_info jsonb` with anon/authenticated select revoked.

- [ ] **Step 1:** Write `0019_lock_policy_remote_levers.sql`: three `alter type public.command_type add value if not exists ...`; `alter table public.customers add column if not exists auto_lock_on_overdue boolean not null default false`; `alter table public.customers alter column emi_amount drop not null, alter column emi_months drop not null, alter column emi_due_day drop not null`; `alter table public.devices add column if not exists sim_info jsonb`; `revoke select (sim_info) on public.devices from anon, authenticated` (mirror 0013 fcm_token revoke).
- [ ] **Step 2:** Regenerate the tail of `0000_all_in_one.sql` to include 0019 verbatim (header migration count + appended body), matching how 0016/0017/0018 were appended.
- [ ] **Step 3: Verify** SQL parses locally by eye against the 0013/0017 patterns (no live DB here). Confirm `device_commands.payload` already exists (it does — 0001) so no payload column is added.
- [ ] **Step 4: Commit** `git add supabase/migrations/0019_*.sql supabase/migrations/0000_all_in_one.sql && git commit -m "sql: 0019 lock policy flag + remote-lever command types + sim_info"`

> Live apply (0019 on the Supabase DB) is a USER/SQL-editor step (documented in spec §7/§11); not runnable from here.

---

### Task 2: Shared types + copy

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/copy.ts`
- Test: `packages/shared/src/*.test.mjs` (tsc is the gate; add strings only)

**Interfaces:**
- Produces: `CommandType` includes `'SET_DEVICE_PIN' | 'SET_WALLPAPER' | 'GET_SIM'`; customer type gains `auto_lock_on_overdue: boolean` and create-input gains optional `track_emi?: boolean` + optional `emi_*`; device/heartbeat type gains `sim_info?: SimInfo | null`; `SimInfo = { carrier: string; phoneNumber: string; imsi: string | null; iccid: string | null }`; copy keys `wallpaperReminder`, `recordEmiNudge` (bn/hi/en).

- [ ] **Step 1:** Extend `CommandType` union and the customer/device/heartbeat interfaces in `types.ts` with the fields above; make `emi_amount/emi_months/emi_due_day` optional on the create-customer input type.
- [ ] **Step 2:** Add the `wallpaperReminder` and `recordEmiNudge` entries to `copy.ts` for en/bn/hi (bn primary for the nudge).
- [ ] **Step 3: Verify** `npx tsc --noEmit -p packages/shared/tsconfig.json` → 0, and `node --test packages/shared/src/*.test.mjs` → 13/13.
- [ ] **Step 4: Commit** `git commit -m "shared: command types, lock-policy + sim_info types, wallpaper/nudge copy"`

---

### Task 3: Web — lock policy at customer creation (track_emi / auto_lock_on_overdue)

**Files:**
- Modify: `web/lib/apiHandlers/retailerCustomers.ts` (required-fields list ~:46, insert ~:66, schedule gen ~:102)
- Modify: `scripts/acceptance_ab.mjs` (add assertion)

**Interfaces:**
- Consumes: shared create-input type (Task 2).
- Produces: POST accepts `track_emi` (default true). When false: EMI fields optional, no `emi_schedules` insert, `auto_lock_on_overdue=false`, `lock_mode='lock'`. When true: today's behavior + `auto_lock_on_overdue=true`.

- [ ] **Step 1: Write the failing assertion** in `acceptance_ab.mjs`: create a customer with `track_emi:false` and no EMI fields → expect 201 and the row has `auto_lock_on_overdue=false` and no schedule rows; create with `track_emi:true` → schedule rows exist and `auto_lock_on_overdue=true`.
- [ ] **Step 2: Run** `node scripts/acceptance_ab.mjs --api http://localhost:3100` (local dev server) → expect the new assertions FAIL.
- [ ] **Step 3: Implement** the branch in `retailerCustomers.ts`: gate the required list and schedule generation on `track_emi !== false`; set `auto_lock_on_overdue` accordingly in the `customers` insert.
- [ ] **Step 4: Run** the acceptance script → new assertions PASS; `npx tsc --noEmit -p web/tsconfig.json` → 0.
- [ ] **Step 5: Commit** `git commit -m "web: no-EMI-record customers (manual-only) + auto_lock_on_overdue"`

---

### Task 4: Web — retailer-controlled release lifecycle

**Files:**
- Modify: `web/lib/apiHandlers/payments.ts:57-62` (remove auto credit-free on completion; queue UNLOCK)
- Modify: `web/lib/apiHandlers/ack.ts` (RELEASE branch: free credit once here)
- Modify: `scripts/acceptance_ab.mjs`

**Interfaces:**
- Consumes: existing `release_device_credit(rid, did)` RPC, `UNLOCK` command insert path.
- Produces: completion no longer frees credit/releases; RELEASE frees credit exactly once + unhide/clear (native side already releases on RELEASE).

- [ ] **Step 1: Write the failing assertion:** pay a loan to completion → `customers.status=COMPLETE`, device still present + credit NOT incremented; then send+ack RELEASE → credit incremented exactly once, release_event written.
- [ ] **Step 2: Run** acceptance → FAIL (today completion frees the credit).
- [ ] **Step 3: Implement:** in `payments.ts` drop the `release_device_credit` call on `completed`; instead insert an `UNLOCK` command for the device and audit `LOAN_COMPLETED_PENDING_RELEASE`. In `ack.ts` RELEASE-executed branch, call `release_device_credit` (guard once).
- [ ] **Step 4: Run** acceptance → PASS; tsc web → 0; `cd web && npx next build` → exit 0.
- [ ] **Step 5: Commit** `git commit -m "web: payoff no longer auto-releases; credit freed on explicit RELEASE"`

---

### Task 5: Web — new command routes + heartbeat sim_info

**Files:**
- Modify: `web/lib/apiHandlers/commands.ts` (retailer command route)
- Modify: `web/lib/apiHandlers/commandProxy.ts` (owner command route)
- Modify: `web/lib/apiHandlers/heartbeat.ts` (accept `sim_info` in body → store on device; deliver command `payload`)
- Modify: `scripts/acceptance_ab.mjs`

**Interfaces:**
- Consumes: `CommandType` (Task 2), `device_commands.payload`, `devices.sim_info` (Task 1).
- Produces: owner+retailer may queue `SET_DEVICE_PIN` (payload `{pin}`, 4–16 digits), `SET_WALLPAPER` (payload `{mode:'reminder'|'clear'}`), `GET_SIM` (no payload); validation rejects missing/oversized payload with 400; heartbeat persists reported `sim_info`.

- [ ] **Step 1: Write failing assertions:** owner and retailer each queue the three commands (expect 201 + a `device_commands` row with correct payload); `SET_DEVICE_PIN` with no `pin` and with a 1000-char pin → 400; a heartbeat POST carrying `sim_info` → stored on the device row and readable.
- [ ] **Step 2: Run** acceptance → FAIL.
- [ ] **Step 3: Implement:** add the three types to the accepted set in `commands.ts` (retailer, tenant+suspension gate, no allowance) and `commandProxy.ts` (owner); validate `pin` is 4–16 digits and `mode` ∈ the enum; in `heartbeat.ts` read `body.sim_info` and write it to `devices.sim_info`, and ensure the pending-command delivery includes `payload`.
- [ ] **Step 4: Run** acceptance → PASS; tsc web + workers → 0; `next build` → 0.
- [ ] **Step 5: Commit** `git commit -m "web: SET_DEVICE_PIN/SET_WALLPAPER/GET_SIM routes + heartbeat sim_info"`

---

### Task 6: Native (device-kit) — reset-password token, set PIN, wallpaper, SIM report, dispatch, SMS

**Files:**
- Modify: `.../EmidostDeviceAdminReceiver.kt` (set reset-password token at provisioning complete)
- Modify: `.../DeviceActions.kt` (or new `DevicePinSetter.kt`): `setResetPasswordToken` + `resetPasswordWithToken`
- Create: `.../EmidostWallpaper.kt` (render reminder bitmap + set/clear)
- Modify: `.../EmidostDeviceManagementModule.kt` (new `Function`s: `setDevicePin(pin)`, `setReminderWallpaper(text)`, `clearWallpaper()`, `reportSimInfo()`)
- Modify: `.../EmidostCommandService.kt:231` (dispatch SET_DEVICE_PIN/SET_WALLPAPER/GET_SIM using command payload; honest ack)
- Modify: `.../EmidostSmsReceiver.kt:46` (add `SETPIN`, `WALL`, `SIM`)
- Modify: `packages/device-kit/index.ts` (JS bindings for the new functions)

**Interfaces:**
- Consumes: command payload from heartbeat (Task 5).
- Produces: JS `setDevicePin(pin:string):Promise<{ok,reason}>`, `setReminderWallpaper(text:string):Promise<{ok}>`, `clearWallpaper():Promise<{ok}>`, `reportSimInfo():SimInfo` exposed from `index.ts`.

- [ ] **Step 1:** At DO confirmation, generate + persist a 32-byte reset token (encrypted prefs) and call `setResetPasswordToken(admin, token)`; implement `setDevicePin` via `resetPasswordWithToken(admin, pin, token, 0)` returning a real `{ok, reason}`.
- [ ] **Step 2:** Implement `EmidostWallpaper` (Canvas bitmap from reminder text, bn/hi/en; `WallpaperManager.setBitmap`/`clear`); expose `setReminderWallpaper`/`clearWallpaper`.
- [ ] **Step 3:** Wire `EmidostCommandService` dispatch for the three types (read payload, call the native fns, ack EXECUTED/FAILED honestly); add `SETPIN <code> <pin>`, `WALL <code> ON|OFF`, `SIM <code>` to `EmidostSmsReceiver` behind the existing gate; add JS bindings in `index.ts`.
- [ ] **Step 4: Verify** `npx tsc --noEmit -p packages/device-kit/tsconfig.json` → 0. (Kotlin compiles only in the EAS build — Task 11; mark native behavior DEVICE-gated.)
- [ ] **Step 5: Commit** `git commit -m "device-kit: set-PIN via reset token, reminder wallpaper, sim report, new command + SMS dispatch"`

---

### Task 7: Customer app — lock-policy gating + release behavior + command execution

**Files:**
- Modify: `apps/customer/src/services/sync.ts` (settled branch; auto-lock gating; execute new commands)
- Create: `packages/shared/src/lockDecision.ts` + `packages/shared/src/lockDecision.test.mjs` (pure helper)
- Modify: `apps/customer/App.tsx` only if UI copy needs the wallpaper/PIN state (minimal)

**Interfaces:**
- Consumes: `auto_lock_on_overdue` + `status` from heartbeat; native fns (Task 6).
- Produces: `shouldAutoLock({autoLockOnOverdue, outstanding, overdue, daysSinceSync}): boolean` — true only when `autoLockOnOverdue && outstanding && overdue && daysSinceSync >= 5`.

- [ ] **Step 1: Write the failing test** `lockDecision.test.mjs`: auto off → always false (even overdue 10 days); auto on + outstanding + overdue + 5 days → true; auto on + 4 days → false; settled → false.
- [ ] **Step 2: Run** `node --test packages/shared/src/lockDecision.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `shouldAutoLock` in `lockDecision.ts`; in `sync.ts` replace the 4-day/5-day/SIM automatic-lock triggers with `shouldAutoLock(...)`; on COMPLETE/SETTLED unlock + stop auto-locks but do NOT unhide/relinquish (unhide stays on RELEASE); execute SET_DEVICE_PIN/SET_WALLPAPER/GET_SIM via the native bindings and ack.
- [ ] **Step 4: Run** `node --test ...` → PASS; `npx tsc --noEmit -p apps/customer/tsconfig.json` and `-p packages/shared/tsconfig.json` → 0.
- [ ] **Step 5: Commit** `git commit -m "customer: retailer-gated auto-lock, no auto-release on payoff, execute new commands"`

---

### Task 8: Retailer app — EMI toggle + Bengali nudge + Release + remote levers

**Files:**
- Modify: `apps/retailer/App.tsx` (new-customer form toggle + Bengali popup; Release action on paid loans; PIN/wallpaper/SIM buttons on device detail)
- Modify: `packages/shared/src/api.ts` (client methods for the new commands if not generic)

**Interfaces:**
- Consumes: web routes (Task 5), copy keys (Task 2).
- Produces: retailer UI to set PIN, set/clear wallpaper, request SIM, and Release.

- [ ] **Step 1:** Add the "Record EMI?" toggle; when off, show the `recordEmiNudge` Bengali popup and allow proceeding with `track_emi:false` (EMI fields hidden/optional).
- [ ] **Step 2:** Add a Release action shown when `status=COMPLETE` (sends RELEASE); add PIN (input), wallpaper (set/clear), and SIM (request + show returned `sim_info`) controls with busy/disabled states + accessibility labels.
- [ ] **Step 3: Verify** `npx tsc --noEmit -p apps/retailer/tsconfig.json` → 0.
- [ ] **Step 4: Commit** `git commit -m "retailer: EMI toggle + bn nudge, Release on payoff, PIN/wallpaper/SIM levers"`

---

### Task 9: Owner app + web console — Release + remote levers

**Files:**
- Modify: `apps/owner/App.tsx` (PIN/wallpaper/SIM + Release on the device view)
- Modify: web console device/customer detail page(s) under `web/app/(portal)/...` (Release on paid loans + the three levers + show `sim_info`)

**Interfaces:**
- Consumes: web routes (Task 5).
- Produces: owner parity for the levers + Release in app and portal.

- [ ] **Step 1:** Owner app: add the lever controls + Release (owner commandProxy path), busy/disabled + labels.
- [ ] **Step 2:** Web console: add the same on the device/customer detail page; render `sim_info` when present.
- [ ] **Step 3: Verify** `npx tsc --noEmit -p apps/owner/tsconfig.json` → 0; `cd web && npx next build` → exit 0.
- [ ] **Step 4: Commit** `git commit -m "owner app + console: Release + PIN/wallpaper/SIM levers"`

---

### Task 10: Full verification + docs truth-up

**Files:**
- Modify: `scripts/acceptance_ab.mjs` (final run), `CONTEXT.md`, `docs/VERIFICATION_CHECKLIST.md`, `docs/FUNCTION_REPORT.md`, `checksum.md`

- [ ] **Step 1: Run** `npm run verify` → 7 tsc + 13+ tests green; `cd web && npx next build` → 0; `node scripts/acceptance_ab.mjs --api http://localhost:3100` → all non-0017/0019-pending checks pass.
- [ ] **Step 2:** Update the docs to reflect the new lock policy, release lifecycle, and three levers with honest DEVICE/CRED tags (new checklist rows; FUNCTION_REPORT entries; a checksum entry).
- [ ] **Step 3: Commit** `git commit -m "docs: lock policy, retailer release, remote levers + honest limits"`

---

### Task 11: Build, deploy, release (version bump → EAS → GitHub → config)

**Files:**
- Modify: `apps/{customer,retailer,owner}/app.json` + `package.json` (version bump to 4.1.0, versionCode +1)

- [ ] **Step 1:** Bump versions (4.0.2 → 4.1.0, versionCode 1 → 2) in all three apps.
- [ ] **Step 2:** Trigger EAS builds: `eas build -p android --profile customer|retailer|owner --non-interactive` in each app dir (customer first per build order). (CRED: EAS; build runs remote.)
- [ ] **Step 3:** When finished, download the three APKs; verify the customer signing-cert SHA is still `2efd…466f` (keystore unchanged) via the scratchpad `apksig.py`.
- [ ] **Step 4:** `gh release create v4.1.0 --repo emidost/emidost ...` with the three APKs; if `customer_apk_url` uses a fixed tag, update `app_config.customer_apk_url` to the v4.1.0 asset (service-role upsert) — else keep a `releases/latest/download` path.
- [ ] **Step 5:** Deploy server: push to `main` (Vercel) and `wrangler deploy` the worker so the new routes are live; run `0019` on the live DB (USER/SQL-editor or Supabase MCP).
- [ ] **Step 6: Verify** the live portal serves the new command routes (401 not 404) and `GET /api/config/customer-apk` still returns the wired URL + SHA.

> This task's device behaviors (PIN/wallpaper/SIM/lock) are DEVICE-gated and proven only on a physical phone; the build/release/deploy steps are the deliverable here.
