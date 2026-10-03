# Retailer-controlled release, lock policy, and remote levers — design

- Date: 2026-10-03
- Status: DRAFT (awaiting user review)
- Scope owner: emidost core (web API + SQL + device-kit native + apps/customer, apps/retailer, apps/owner)

## 1. Goal and agreed understanding

Shift the lock lifecycle from automatic to **retailer-controlled**, and add
four remote management levers usable both online (server command) and offline
(SMS). Decisions confirmed with the user:

1. **Final payment no longer auto-releases.** When the last EMI is paid the
   screen unlocks (the customer can use the phone), but the device stays
   Device-Owner managed and hidden until the retailer explicitly issues
   `RELEASE`. The device credit is freed on `RELEASE`, not on completion.
2. **Lock policy is chosen per customer at creation:**
   - **Record EMI** (EMI schedule tracked): overdue → automatic lock at **5
     days with no server update** + overdue voice/reminders; manual lock also
     available.
   - **No EMI record**: **manual lock only**; the phone is fully silent/passive
     (no automatic locks, no overdue voice/reminders), just always-on listening
     for SMS + server commands. Choosing this shows a **Bengali popup** nudging
     the retailer to record EMI for automatic protection.
3. **Remote levers (owner + retailer, online + SMS):** set the exact device
   PIN, set/clear a reminder wallpaper, fetch SIM info, fetch location
   (location already exists).
4. The command service stays alive and listening (SMS + server poll) in every
   mode — affirm and test the existing `EmidostCommandService` behavior.

Non-negotiable honesty rule (carried from the repo): the phone never fakes a
result. Every new native action reports a real ok/fail readback; device-only
behaviors are marked DEVICE and never claimed as proven until a physical pass.

## 2. Lock policy state machine

Per-customer field (new): `customers.auto_lock_on_overdue boolean not null
default false`. Set `true` when the retailer picks "Record EMI", `false` for
"No EMI record". (The existing `lock_mode` and `overdue_escalation_enabled`
remain; see interaction below.)

States and transitions for a bound, active device:

| Condition | Automatic lock | Overdue voice/reminders | Manual LOCK (server/SMS) | App icon |
|---|---|---|---|---|
| EMI tracked (`auto_lock_on_overdue=true`), loan outstanding | Overdue + 5 days no server update → hard lock | On (due-day 3x + overdue escalation per existing rules, respecting the kill-switch) | Yes | hidden |
| No EMI record (`auto_lock_on_overdue=false`), loan outstanding | None (4-day and 5-day watchdogs and SIM-sentinel lock are suppressed) | Off (silent) | Yes | hidden |
| Loan COMPLETE/SETTLED, not yet released | None; any active lock cleared (screen usable) | Off | Yes (retailer may still lock before release) | hidden |
| After `RELEASE` | n/a (DO relinquished) | Off | n/a | unhidden ("wifi" visible) |

Key change: the **4-day overdue-offline watchdog** and the **5-day no-internet
watchdog** and the **SIM-sentinel hard lock** are gated behind
`auto_lock_on_overdue`. When it is false they are fully suppressed. When true,
the overdue auto-lock is defined as **loan outstanding AND overdue AND ≥5 days
since the last successful server sync** (one unified rule; replaces the prior
split 4-day/5-day wording in the lock plan). Manual LOCK via server or SMS is
never gated by this flag.

Interaction with existing fields:
- `lock_mode` ('lock'|'notify_only'): `notify_only` stays "never hard-locks at
  all" (even manual). The new flag is orthogonal; "No EMI record" implies
  manual-only but still lockable on demand, which is `lock_mode='lock'` +
  `auto_lock_on_overdue=false`. The customer-create flow sets both from the one
  retailer choice (Record EMI → lock + auto true; No record → lock + auto
  false). `notify_only` remains available but is not surfaced by the new toggle.
- `overdue_escalation_enabled` kill-switch keeps its meaning and still applies
  on top of EMI-tracked mode.

## 3. Feature designs

### 3.1 Retailer-controlled release lifecycle

- `web/lib/apiHandlers/payments.ts`: on `result.completed`, **do not** call
  `release_device_credit`. Instead queue an `UNLOCK` command for the device so
  the screen becomes usable, and leave the device managed/hidden. Audit
  `LOAN_COMPLETED_PENDING_RELEASE`.
- Move credit free + release semantics to the existing `RELEASE` path
  (`ack.ts`/command flow): `RELEASE` executed → free credit
  (`release_device_credit`), write the release event, clear fcm token
  (existing), unhide the app, clear protections.
- `apps/customer/src/services/sync.ts` settled branch: on COMPLETE/SETTLED →
  unlock + stop sentinel/overdue/watchdog auto-locks, but **do not** `hideSelf`
  toggling to unhide and **do not** relinquish DO. Full unhide + clear
  protection happens only on the `RELEASE` command handler (already present).
- UI: retailer app + owner console device/customer detail gains a **Release**
  action, prominently enabled when `status=COMPLETE` (label e.g. "Paid —
  release device"). Retailer already can send RELEASE; this surfaces it on paid
  loans.

### 3.2 `SET_DEVICE_PIN` — set the exact lock-screen PIN

- SQL: add `SET_DEVICE_PIN` to `command_type`.
- Native (device-kit, new):
  - At activation (first confirmed Device Owner, in
    `EmidostDeviceAdminReceiver.onProfileProvisioningComplete` and/or the
    module when DO is detected): generate a random 32-byte reset token, persist
    it (encrypted prefs), and call
    `dpm.setResetPasswordToken(admin, token)`.
  - New `Function("setDevicePin") { pin: String -> ... }`: calls
    `dpm.resetPasswordWithToken(admin, pin, token, 0)`; returns
    `{ ok, reason }` honestly (false when the OS/OEM refuses or the token was
    never activated).
- Server: `commands.ts` + `commandProxy.ts` accept `SET_DEVICE_PIN` (owner +
  retailer; tenant + suspension gates; no allowance debit; refused on
  COMPLETE/SETTLED only after RELEASE — allowed while managed). The chosen PIN
  travels in `device_commands.payload.pin` and is delivered to the phone over
  the authenticated TLS heartbeat (same trust channel as the TOTP secret). The
  PIN is never stored in plaintext beyond the pending command row; audit
  records the event without the value.
- Offline SMS: `SETPIN <customer-code> <pin>` from an allowlisted sender →
  `EmidostSmsReceiver` validates sender allowlist + customer code, then
  `setDevicePin`. (SMS is spoofable; documented. Sender allowlist + customer
  code are the gate, same as other SMS commands.)
- UI: owner + retailer get a "Set phone PIN" field + confirm on the device
  detail screen.

Honest limits (DEVICE, baked into docs):
- Requires a **new build**; the token is set at activation, so **only phones
  (re-)enrolled with this build can have their PIN set**. Already-provisioned
  phones must be re-enrolled.
- `resetPasswordWithToken` is reliable on Android ≤12; some Android 13+/OEM
  builds require the token to be activated via a credential confirmation and
  may refuse silent set. The function reports the real failure; we never claim
  success we did not get.
- Unverifiable without a physical device.

### 3.3 `SET_WALLPAPER` (reminder) + clear

- SQL: add `SET_WALLPAPER` to `command_type`.
- Native (new): `Function("setReminderWallpaper") { text: String }` renders a
  bitmap (EMI reminder lines + retailer contact, bn/hi/en from copy) via Canvas
  and `WallpaperManager.setBitmap`; `Function("clearWallpaper") {}` calls
  `WallpaperManager.clear()`. Both return `{ ok }`.
- Server: `SET_WALLPAPER` with `payload.mode = 'reminder' | 'clear'` (owner +
  retailer; tenant + suspension gates; no allowance debit).
- Offline SMS: `WALL <customer-code> ON|OFF`.
- UI: owner + retailer "Set reminder wallpaper" / "Clear wallpaper" buttons.
- On-device generated bitmap only (no upload pipeline). Image content pulls
  from the plan the phone already caches (amount, due date, retailer phone).

### 3.4 `GET_SIM` — fetch SIM info

- SQL: add `GET_SIM` to `command_type`.
- Reuse native `getSimInfo` (carrier, phoneNumber best-effort, IMSI, ICCID).
- Online: `GET_SIM` command → the phone reports its SIM info to the server on
  the next heartbeat (new optional `sim_info` field on the heartbeat POST body;
  stored on the `devices` row in a `sim_info jsonb` column, new); shown in the
  device detail. Owner + retailer.
- Offline SMS: `SIM <customer-code>` → the phone SMS-replies to the sender with
  carrier + number (if available) + last 4 of ICCID.
- Honest: the dialable number (`line1Number`) is usually blank on modern
  Android; carrier + IMSI/ICCID are the reliable parts.

### 3.5 "No EMI record" customer creation + Bengali popup

- `web/lib/apiHandlers/retailerCustomers.ts`: make `emi_months`, `emi_amount`,
  `emi_due_day` **optional** when the request carries `track_emi=false`; when
  false, skip `emi_schedules` generation and set `auto_lock_on_overdue=false`;
  when true (default), keep today's required fields + schedule and set
  `auto_lock_on_overdue=true`.
- `apps/retailer/App.tsx` new-customer form: a "Record EMI?" toggle. When the
  retailer turns it off, show a **Bengali popup** (copy in
  `packages/shared/src/copy.ts`, bn primary) explaining that recording EMI
  enables automatic overdue protection, and that without it the phone is manual
  lock only. Retailer can proceed either way.

## 4. Data model (migration `0019_lock_policy_remote_levers.sql`)

- `alter type public.command_type add value if not exists 'SET_DEVICE_PIN';`
- `... add value if not exists 'SET_WALLPAPER';`
- `... add value if not exists 'GET_SIM';`
- `alter table public.customers add column if not exists auto_lock_on_overdue
  boolean not null default false;`
- `alter table public.devices add column if not exists sim_info jsonb;`
  (revoke select from anon/authenticated if it may carry sensitive IMSI/ICCID;
  mirror the 0013 fcm_token revoke pattern.)
- Make EMI columns nullable if they are currently NOT NULL (check 0001; add a
  guard so "no record" rows are valid).
- Regenerate `0000_all_in_one.sql` (header + appended 0019), per repo
  convention. `device_commands.payload` already exists — no change.

## 5. Shared + copy

- `packages/shared/src/types.ts`: extend `CommandType` with the three new
  values; add `auto_lock_on_overdue` and `track_emi` to the customer types;
  add `sim_info` to the device/heartbeat types.
- `packages/shared/src/copy.ts`: bn/hi/en strings for the reminder wallpaper,
  the Bengali "record EMI" nudge popup, and any new UI labels.
- Note: `packages/shared` must stay DOM-free (type-checked under RN lib
  ES2020) — no browser globals in new shared code.

## 6. SMS command additions

`EmidostSmsReceiver` gains: `SETPIN <code> <pin>`, `WALL <code> ON|OFF`,
`SIM <code>`. All reuse the existing sender-allowlist + customer-code gate and
the per-command debounce. `SIM` and `SETPIN` responses/acks follow the existing
SMS ack pattern. Document the spoofable-SMS caveat for `SETPIN`.

## 7. Build and release impact

- Native + app changes land in all three apps → **rebuild customer, retailer,
  and owner on EAS**, re-download, and **re-upload to the GitHub release**
  (bump to the next version, e.g. 4.1.0). The signing keystore is unchanged, so
  the QR signing-SHA stays `2efd…466f` — no QR config re-wiring.
- The customer APK URL in `app_config` stays the same stable release path if we
  reuse `releases/latest/download/...`; otherwise update `customer_apk_url` to
  the new tag. Decide tag scheme at release time.

## 8. Testing

- `scripts/acceptance_ab.mjs`: add server-side assertions — (a) final payment
  marks COMPLETE but does **not** free the credit and does **not** release;
  `RELEASE` frees the credit; (b) `SET_DEVICE_PIN`/`SET_WALLPAPER`/`GET_SIM`
  queue + ack round-trips with role gates (owner + retailer) and payload
  integrity; (c) "no EMI record" customer creation succeeds without EMI fields
  and sets `auto_lock_on_overdue=false`.
- `npm run verify` (7 tsc surfaces + node tests) must stay green.
- Add a shared unit test for any new pure logic (e.g. the overdue/5-day
  decision helper) following the `stale.ts` test pattern.
- DEVICE-gated (cannot verify here, marked honestly): actual PIN set, wallpaper
  set/clear, SIM number read, and the lock-policy behavior on hardware.

## 9. Honest limits (carried into CONTEXT/checklist/FUNCTION_REPORT on build)

- Set-PIN: build + re-enrol requirement; Android 13+/OEM refusal possible;
  SMS spoofable; unverifiable without a device.
- SIM number often blank on modern Android.
- Wallpaper/PIN/lock behaviors are DEVICE-gated until a per-OEM pass.

## 10. Out of scope (YAGNI)

- Owner-uploaded branded wallpaper image pipeline (chose on-device bitmap).
- Changing the TOTP/overlay/escalation mechanisms.
- Any change to the enrolment QR beyond what the release/version bump requires.

## 11. Open items to resolve during planning

- Confirm whether `customers` EMI columns are currently NOT NULL (0001) and the
  minimal nullability change.
- Confirm the exact RELEASE handler location that frees credit (ack vs command
  proxy) and move the credit-free there cleanly.
- Decide the release tag/version and whether to point `customer_apk_url` at a
  fixed `releases/latest/download` path to avoid re-wiring on every rebuild.
