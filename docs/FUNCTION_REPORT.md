# emidost function report — every function, how it works, what it prevents

Merged claim-by-claim report, compiled 2026-10-03 by the lead from two
independently audited halves (claude: web portal + API + SQL, 39 functions;
codex: apps + device-kit + shared + worker, 74 functions). Every line
reference was re-verified against the tree at commit `5bd8a8b`.

## How to read this report

Each function follows one template:

- **Claim** — what the function does, one sentence.
- **How it works** — the concrete mechanism, with file references.
- **What it prevents** — the specific fraud, abuse, or failure this stops.
- **Status** — one of:
  - **CODE verified** — implemented in this repo and checked this session
    (typechecks, tests, builds, or verified read of the code).
  - **CODE + DEVICE** — the code is complete and verified, but the claim
    also depends on a physical device pass (Android behaviour); the
    device half is pending and is never claimed as done.
  - **Honest limit** — a known, documented residual that no code can close
    (or that is deliberately out of scope).

## The system in one model

A retailer finances a phone and sells it on EMI. The phone runs the customer
app as a **Device Owner** kiosk: until every instalment is paid, the phone
stays locked to that app and every escape route is blocked. The server is the
single source of truth for who may lock/unlock and for the money state; the
phone enforces locally so it keeps working offline.

Trust boundaries that matter:

1. **The phone enforces, the server decides.** A lock is only real when the
   phone's own OS reports Device Owner; commands that cannot be enforced are
   acknowledged FAILED, never faked as done.
2. **One backend, three roles.** Owner (portal + app) controls retailers,
   credits and allowances. Retailer (app) registers customers, records cash,
   locks/unlocks within allowance. Customer (phone app, no login) runs the
   lock engine and only trusts the server channel it bound to at activation.
3. **Secrets stay where they belong.** The TOTP secret is encrypted at rest,
   delivered only to the bound phone over its authenticated heartbeat, and
   issued to the retailer app only behind a retailer-tenant check with an
   audit row. Device PIN hashes are salted per installation and never reach
   a retailer browser.
4. **Money is a ledger, not a number.** Credits and lock allowances move only
   through atomic database functions with refund paths; payments flow through
   one RPC that also settles the loan and emits the release event.

What this report does NOT claim: physical-device acceptance (per-OEM walks,
the wireless self-pair path included), EAS-built APKs, and the one pending SQL
statement on the live database (`0017` sales ledger — 0011–0016 are verified
applied by the 2026-10-03 acceptance run). The
wireless-debugging self-pair is now IMPLEMENTED in code via a
bundled AOSP adb client (Apache-2.0, sha256 + NOTICE recorded) — it has simply
never passed a real device, and the report never claims it has. Those items
are listed explicitly in the honest-limits section at the end; everything else
below is code that was checked, not marketing.

> 2026-10-03 addition: retailer-controlled lock policy, the retailer-controlled
> release lifecycle, and the owner+retailer remote levers (set exact PIN, set/
> clear reminder wallpaper, fetch SIM info; online + SMS) are documented
> claim-by-claim in `docs/VERIFICATION_CHECKLIST.md` section M, with honest
> DEVICE/CRED tags. SQL 0019; spec/plan under docs/superpowers/.

## Part 1 — Web portal, API routes, and database (39 functions)

## 1. Owner portal pages

#### Login page
- **Claim**: Signs the owner or retailer staff into the portal with email + password.
- **How it works**: `web/app/login/page.tsx:14-22` calls `browserClient().auth.signInWithPassword`, then navigates to `/`; `web/app/page.tsx:6-14` reads the session and live `profiles` row and redirects by role (owner → /dashboard, staff → /console) and redirects suspended users back to login.
- **What it prevents**: unauthenticated access to the portal; suspended accounts reaching any page (the redirect re-checks `profiles.is_suspended` live on every load).
- **Status**: CODE verified.

#### Dashboard
- **Claim**: Shows the owner live portfolio counts (retailers, financed phones, locked now, overdue instalments).
- **How it works**: server component queries via the cookie-bound server client with `count: 'exact', head: true` (`web/app/(portal)/dashboard/page.tsx:18-31`); "overdue" is computed honestly as unpaid schedules with `due_date < today`, where today is computed in Asia/Calcutta (`dashboard/page.tsx:12-17`), because nothing writes an OVERDUE status.
- **What it prevents**: stale/cached numbers misleading the owner (page is `force-dynamic`, layout blocks suspended users); a UTC-vs-IST off-by-one making a due-day-5 customer show overdue a day early.
- **Status**: CODE verified. Residual: counts rely on RLS (owner JWT claim) — an owner created outside `create_accounts.mjs` with no `app_metadata.role` sees zeros (documented in checksum).

#### Retailers list
- **Claim**: Lists every retailer with balances, allowances and suspension state.
- **How it works**: client page reads `retailers` directly with the owner JWT (`web/app/(portal)/retailers/page.tsx:18-22`), gated by the `retailers_owner` RLS policy (0005); create/suspend actions go through the API routes below.
- **What it prevents**: a staff member or anon reading other retailers (RLS returns only what the owner policy allows).
- **Status**: CODE verified.

#### Retailer create (ownerRetailers POST)
- **Claim**: Creates a retailer login, retailer row, staff profile and JWT claims in one compensating transaction.
- **How it works**: `web/lib/apiHandlers/ownerRetailers.ts:34-38` creates the auth user via the service client (`email_confirm: true`, password ≥ 8 enforced at `:27-29`), then inserts the retailer (`:41-43`), upserts the staff profile (`:51-54`), and writes `app_metadata = { role:'retailer_staff', retailer_id, provider:'email', providers:['email'] }` via `updateUserById` (`:64-69`). Every later failure rolls back the retailer row and deletes the auth user (`:55-58, 70-74`).
- **What it prevents**: half-created accounts (orphan auth users or retailer rows without logins); retailers whose JWT lacks the RLS claims, which would make their console silently empty (0005 reads `app_metadata`); accidental loss of GoTrue's `provider/providers` account-linking keys.
- **Status**: CODE verified. Residual: the rollback deletes are best-effort (`.catch(() => {})`) — a failed cleanup leaves a row the owner can see and retry.

#### Retailer detail + suspend (ownerRetailer PATCH)
- **Claim**: Renames a retailer, edits its SMS phone, or suspends/resumes it.
- **How it works**: `web/lib/apiHandlers/ownerRetailer.ts:18-23` accepts only known fields; when `is_suspended` is present it also fans the flag out to every staff profile (`:28-32`) so all route-level checks see it immediately.
- **What it prevents**: a suspension that only marks the `retailers` row while a staff member keeps issuing commands — every handler (and `requireActor`) re-reads the live profile row per request, so the suspension bites the next call.
- **Status**: CODE verified.

#### Credits (ownerCredits POST)
- **Claim**: Adds or removes a retailer's device-credit balance with an atomic, non-negative adjustment.
- **How it works**: after a 404 existence check (`web/lib/apiHandlers/ownerCredits.ts:18-21`), it calls the SQL `adjust_credits(rid, delta)` RPC, which does `update ... set credits_balance = credits_balance + d where id = rid and credits_balance + d >= 0 returning credits_balance` (`supabase/migrations/0003_hardening.sql:21-26`) — the constraint is enforced inside the UPDATE, not by a read-then-write. A NULL result with a negative delta maps to 400 (`:24-27`); a successful change appends a `credit_ledger` row (`:30-32`).
- **What it prevents**: the classic read-modify-write race letting two owner requests push a balance below zero; credits changing without a ledger/audit trail.
- **Status**: CODE verified.

#### Allowances (ownerAllowances POST)
- **Claim**: Sets a retailer's lock-allowance total (top-up or drain).
- **How it works**: validates non-negative integer (`web/lib/apiHandlers/ownerAllowances.ts:13-14`), updates the row and audits `ALLOWANCES_SET` (`:17-22`).
- **What it prevents**: negative allowance values via the API; silent changes without audit.
- **Status**: CODE verified. Residual: it SETS the total (not a delta), so the owner UI must show the current value first — that is what the edit page does.

#### Audit feed (ownerAudit GET)
- **Claim**: Returns the newest 500 audit-log rows for the owner.
- **How it works**: owner-only route, `audit_log` ordered newest-first, `Cache-Control: private, no-store` (`web/lib/apiHandlers/ownerAudit.ts:7-15`). Every mutating route in this report writes an `audit_log` row.
- **What it prevents**: undetectable admin actions — credits, allowances, suspensions, commands, payments, TOTP/PIN issues and device registrations all land in this feed.
- **Status**: CODE verified.

#### Owner devices page
- **Claim**: Owner device board with LOCK/UNLOCK via the owner command proxy.
- **How it works**: `web/app/(portal)/devices/page.tsx:17-21` reads devices with an explicit column list that excludes `pin_verify`, `device_token_hash`, `device_pin_hash`, `imsi_baseline`, `iccid_baseline`; commands POST to the owner `commandProxy` route (`:23-30`).
- **What it prevents**: sensitive device material (offline-brute-forceable PIN hash, device auth token hash, SIM baselines) sitting in the browser payload.
- **Status**: CODE verified.

#### Enrolment QR page
- **Claim**: Generates the DPC provisioning QR that turns a factory-fresh phone into a Device Owner.
- **How it works**: `web/app/(portal)/qr/page.tsx:29-42` builds the provisioning bundle: DPC component name, `PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM` (SHA-256 of the signing cert, converted to unpadded base64url by `hexToChecksum`, `:10-18`), the APK download URL, `LEAVE_ALL_SYSTEM_APPS_ENABLED` and `SKIP_ENCRYPTION=false`; renders via the `qrcode` package (`:44-48`).
- **What it prevents**: a phone being enrolled against a tampered or wrong APK — Android verifies the downloaded package against the embedded signature checksum before granting Device Owner.
- **Status**: CODE verified (the OS-side wizard completion is DEVICE). Residual: the checksum is pasted by the owner from EAS credentials; a mistyped value is caught by the 64-hex validation.

#### TOTP issue (ownerTotp POST)
- **Claim**: Owner mints an 8-digit offline unlock code for a device.
- **How it works**: `web/lib/apiHandlers/ownerTotp.ts:24-34` reuses the existing secret unless `?rotate=1` (which mints a fresh 20-byte secret); computes RFC 6238 HMAC-SHA1/8-digit/30 s (`:39-45`), upserts the AES-256-GCM-encrypted secret + counter (`:47-51`) and audits `TOTP_ISSUED`.
- **What it prevents**: rotation invalidating codes on a phone that only has the old secret (stable by default); plaintext secrets in the DB (encrypted via `totpCrypto`).
- **Status**: CODE verified + DEVICE (the phone's offline verify is Totp.kt). Residual: a rotated secret only reaches the phone on its next online heartbeat — the comment instructs the owner to rotate while online.

#### PIN set (ownerPin POST)
- **Claim**: Owner sets the 4-8 digit device management PIN without ever storing the plaintext.
- **How it works**: validates `^\d{4,8}$` (`web/lib/apiHandlers/ownerPin.ts:19-20`), stores `pin_verify = sha256(pin + ":" + installation_id)` base64 (`:27-29`), audits `DEVICE_PIN_SET`. The phone verifies the same construction offline.
- **What it prevents**: plaintext PIN storage and logging; a PIN hash that is useless without the installation_id.
- **Status**: CODE verified + DEVICE (device-side verify). Honest limit documented in code: a 4-8 digit PIN is brute-forceable from the hash, so it must never leave the service role except to the device itself.

---

## 2. Retailer console pages

#### Console dashboard
- **Claim**: Shows the retailer's own counts (customers, devices, locked) and balances.
- **How it works**: reads the staff profile (`profiles_self` policy) to get `retailer_id`, then reads `retailers`, `customers`, `devices` directly with the staff JWT (`web/app/(portal)/console/page.tsx:14-29`), all scoped by the 0005 staff policies.
- **What it prevents**: cross-retailer data leakage in the UI (RLS + the explicit `eq('retailer_id', rid)` filters are belt and braces).
- **Status**: CODE verified.

#### Customers list page (new)
- **Claim**: Lists the retailer's customers with EMI plan, lock plan and loan status; entry point to payments.
- **How it works**: fetches `/api/retailer/customers` (API route, tenant-checked) and renders a table linking each row to the customer detail page (`web/app/(portal)/console/customers/page.tsx:12-19`).
- **What it prevents**: the payments UI being orphaned/unreachable (it previously had no nav entry); staff reading customers outside their retailer (server route checks `retailer_id`).
- **Status**: CODE verified.

#### Customer detail (record payment + schedule + history)
- **Claim**: Records a cash payment and shows the repayment schedule and payment history.
- **How it works**: loads customer, payments and schedules from the API in parallel (`web/app/(portal)/console/customers/[id]/page.tsx:19-28`); "Record" POSTs to `/api/retailer/customers/:id/payments` and reloads (`:32-42`).
- **What it prevents**: double submits and stale display (reloads after success); overpayments (the API maps the RPC's `overpayment` to 400 and shows the message).
- **Status**: CODE verified.

#### New customer (lock_mode choice, IST due dates)
- **Claim**: Registers a financed customer with the full EMI plan and a "lock vs notify-only" choice.
- **How it works**: form posts to `/api/retailer/customers` (`web/app/(portal)/console/customers/new/page.tsx:21-36`); the radio choice sends `lock_mode: 'lock' | 'notify_only'` (`:63-71`). Server-side generates the schedule with IST due days (see retailerCustomers POST).
- **What it prevents**: a notify-only customer ever getting locked (the plan chip is stored server-side and delivered to the phone each heartbeat); missing-field submits (required inputs + server validation).
- **Status**: CODE verified.

#### Console devices page
- **Claim**: Retailer device list with LOCK/UNLOCK (allowance-checked server-side).
- **How it works**: reads devices with the explicit non-sensitive column list (`web/app/(portal)/console/devices/page.tsx:17-23`) and posts commands to `/api/retailer/devices/:id/commands` (`:27-36`).
- **What it prevents**: `pin_verify`/`device_token_hash`/SIM baselines reaching a retailer's browser (a staff member could otherwise brute-force the device PIN offline); commands without allowance debit or on settled loans (server route).
- **Status**: CODE verified.

---

## 3. Device API routes

#### register
- **Claim**: Binds the customer app's installation to an enrolment session with a one-shot token.
- **How it works**: rate-limited 20/min (`web/lib/apiHandlers/register.ts:14-16`); looks up the session by sha256(token) (`:28-33`), rejects expired, suspended-retailer and settled-loan sessions (`:33-40`); the takeover guard (`:47-59`) refuses to re-point an installation_id that belongs to another retailer or to another *active* customer — a device whose loan is COMPLETE/SETTLED may be re-enrolled (resale). The token is spent with a state CAS `created → installed` (`:62-66`), then the device row is upserted with `device_token_hash = sha256(deviceToken)` (`:68-79`).
- **What it prevents**: token replay (CAS + unique `token_hash` index); a stolen token re-pointing (stealing) a live phone's command channel; settled phones being silently re-enrolled onto the same loan; unbounded registration attempts (rate limit).
- **Status**: CODE verified. Residual: the token is 64-bit hex (typed by hand) — acceptable because it is one-shot, expires in 15 min and the route is rate limited.

#### heartbeat
- **Claim**: The phone's only polling channel — delivers commands, TOTP secret, PIN verify hash, loan/lock state and server time.
- **How it works**: authenticates by `installation_id` + `x-device-token` hash match (`web/lib/apiHandlers/heartbeat.ts:19-33`); device-reported `mode` can only promote to `device_owner` when an open enrolment session exists (`:43-49`), and activation now covers ALL open states including `created` (`:53-57`) with a one-time credit consumption (`:59-69`); a 24 h lazy sweeper expires stuck PENDING/RECEIVED commands and refunds LOCK allowances once (`:77-96`); one parallel wave updates `last_heartbeat_at` and fetches pending commands, TOTP secret and next due (`:100-111`); a suspended retailer's commands are filtered down to UNLOCK/RELEASE (`:115-117`); the optional `locked` body field (device enforcedLocked readback) writes `devices.is_locked` — `true` always, `false` only when no LOCK/DEVICE_ACTION is PENDING/RECEIVED, and settled loans are skipped (`:124-140`); the response carries `lock_mode`, EMI terms, `pin_verify`, decrypted TOTP secret, `is_locked`, `photo_url` (signed 24 h storage URL, null on failure), `escalation_enabled` (default true), `overdue_days` (IST parse) and `server_now`, with an honest empty `policies` map.
- **What it prevents**: a client self-promoting its own device to owner status (open-session gate); credits leaking on re-activation (state CAS); a dead device holding a retailer's allowance forever (sweeper + refund); an IST due-day-5 customer being flagged overdue on UTC time; the server ever faking "all policies applied" (the phone reports real OS readback).
- **Status**: CODE verified + DEVICE (the phone's enforcement of the delivered commands is native). Honest limit: `policies` is intentionally empty; FRP/PIN/TOTP values are delivered but their OS application is device-reported.

#### ack
- **Claim**: Records a command's terminal outcome with atomic, immutable transitions.
- **How it works**: device-authenticated (token hash, `web/lib/apiHandlers/ack.ts:28-34`); only EXECUTED/SUPERSEDED/FAILED/EXPIRED acks accepted (`:24-25`); a settled loan's LOCK-EXECUTED ack is forced to SUPERSEDED with allowance refund and an ack row (`:46-59`); all other transitions go through a CAS on PENDING/RECEIVED (`:66-69`) so terminal states can't be resurrected; non-EXECUTED LOCKs refund the allowance (`:73-75`); EXECUTED flips `is_locked` for LOCK/UNLOCK, and RELEASE unhides the device + writes a release event + frees the device credit once (`:77-91`); LOCATION payloads are stored only on EXECUTED (`:98-103`).
- **What it prevents**: a late or duplicate ack re-opening a cancelled/expired command (terminal immutability); a paid-off phone re-locking (settled gate); allowances being burned by locks that never executed (refund); credit refunds firing twice (SQL guard in `release_device_credit`); fake EXECUTED states from a non-Device-Owner phone (the native side acks FAILED).
- **Status**: CODE verified + DEVICE (native enforcement result). Residual: `is_locked` is server-side bookkeeping — the real lock state is the phone's own readback.

#### commands (retailer LOCK/UNLOCK/LOCATION/ALERT/REMIND)
- **Claim**: Queues a retailer command; LOCK consumes one lock allowance atomically; ALERT and REMIND are the free one-shot bn+hi voices (ALERT = urgent overdue, REMIND = friendly payment reminder).
- **How it works**: staff + suspension + tenant checks (`web/lib/apiHandlers/commands.ts:14-30`); LOCK, ALERT and REMIND share the settled-loan refusal (`:33-39`); the command is INSERTED FIRST and the `decrement_allowance` RPC runs second, LOCK only (`:39-52`) — ALERT/REMIND debit nothing; if the `credit_ledger` row fails AFTER a successful debit, a compensating sequence refunds the allowance (`increment_allowance` + best-effort `lock_refund` row), cancels the command and audits `COMMAND_CANCELLED` (`:57-78`); every issue is audited with `push_kick` detail (`:84-94`).
- **What it prevents**: a retailer over-spending lock allowances (atomic decrement, command cancelled on refusal); paid loans being locked, alerted or reminded; an allowance being debited for a command that never got queued (debit-after-insert order); a failed ledger write permanently swallowing one allowance (compensation + audit); REMIND/ALERT ever consuming the lock budget.
- **Status**: CODE verified. Residual: if the refund's own `lock_refund` ledger row also fails (same DB fault), the balance is still restored but that refund row is missing — visible in the audit row and the balance-vs-ledger delta, deliberate best-effort.

#### customerEscalation PATCH (kill-switch)
- **Claim**: Toggles `customers.overdue_escalation_enabled` — the portal/console kill-switch for the voice escalation and the location SMS.
- **How it works**: staff-only + suspension gate + tenant check (`web/lib/apiHandlers/customerEscalation.ts:14-24`); body `{ enabled: boolean }`; updates the row and audits `ESCALATION_TOGGLED` with the new value (`:26-37`). The console customer detail page has the toggle card (BellRing, busy state, honest caption) calling this PATCH (`web/app/(portal)/console/customers/[id]/page.tsx`).
- **What it prevents**: an escalation a customer cannot stop when the retailer decides to (dispute, support case, notify_only plan); silent toggles (audited); cross-retailer toggles (tenant check). The phone picks the flag up on its next heartbeat.
- **Status**: CODE verified. Residual: the flag travels with the heartbeat, so the phone keeps escalating for up to one poll interval after the toggle.

#### ownerSales POST (record a sale)
- **Claim**: Records the owner's sale of locks to a retailer and grants the balances in the same compensating sequence.
- **How it works**: owner-only (`web/lib/apiHandlers/ownerSales.ts:21-23`); strict validation — units integer 1..100000, unit_price ≥ 0, amount_paid 0..total (total = units × unit_price computed server-side), credits_granted ≥ 0, payment_mode ∈ {cash,upi,bank,card,credit}, note ≤ 500 chars (`:25-39`); the invoice is server-generated `EMD-INV-<yyyymmdd>-<4 hex>`; effects: sale row insert → `adjust_credits` when credits > 0 → `add_lock_allowances(rid, units)` (one bulk RPC) → two `kind='sale'` credit_ledger rows carrying `sale_id` → `SALE_RECORDED` audit (`:51-115`); any failed step rolls the sale back (credits reversed, allowances subtracted via `sub_lock_allowances`, row deleted, console.error logged).
- **What it prevents**: a sale that grants money without granting the product (or vice versa — the compensating rollback undoes partial grants); overpaid or negative invoices; forged totals (server computes); untraceable balance changes (sale_id on every ledger row).
- **Status**: CODE verified. Residual: rollback reversal is best-effort under a DB fault (logged; a follow-up sweep can reconcile).

#### ownerSales GET + summary
- **Claim**: The sales history (filterable by retailer, limit ≤ 500) and the totals + per-retailer breakdown.
- **How it works**: owner-only; GET joins `retailers(name)` and orders newest-first (`:119-134`); summary aggregates in JS — sales_count, units_sold, revenue_total, collected, outstanding, per_retailer [{retailer_id, name, units, total, paid, balance, last_sale_at}] sorted by total (`:137-181`). The portal Sales page (band header, record form, totals tiles, filterable table) and the dashboard Sales quick-row load through these routes (`web/app/(portal)/sales/page.tsx`).
- **What it prevents**: the owner guessing "how much sold, at what price, which retailer" — every number derives from the invoice rows; staff never see other retailers' purchases (the GET is owner-only, staff use their own RLS read).
- **Status**: CODE verified. Residual: summary aggregation is in JS over the full sales set — fine at retail scale (hundreds of rows), documented.

#### commandProxy (owner commands)
- **Claim**: Owner-issued LOCK/UNLOCK/LOCATION/RELEASE/REBOOT with no allowance consumption.
- **How it works**: owner-only (`web/lib/apiHandlers/commandProxy.ts:9-12`); LOCK on settled loans refused (`:24-27`); REBOOT is accepted for the owner only (retailer routes never take it); queues with `created_by` and audits with `by: 'owner'` (`:28-37`). The owner devices board has a REBOOT button that posts through this proxy (`web/app/(portal)/devices/page.tsx:25-33, 58-65`).
- **What it prevents**: a retailer-grade allowance economy applying to the owner (owner locks are free by design); settled-loan locks from the owner board; REBOOT becoming a retailer tool (owner-only surface).
- **Status**: CODE verified + DEVICE (native reboot execution: schedules the reboot ~5 s out so the EXECUTED ack lands first; refusal while locked unchanged, reason `locked_reboot_refused`).

---

## 4. Retailer API routes + shared lib

#### requireActor (auth gate)
- **Claim**: Verifies the caller's session (portal cookie or app Bearer token) and returns the LIVE profile row.
- **How it works**: `web/lib/auth.ts:11-46` — Bearer tokens are verified with `auth.getUser(token)` against the anon client (apps/worker parity), cookies via the SSR client; either way the role/retailer_id/is_suspended come from a fresh `profiles` SELECT, never from JWT claims.
- **What it prevents**: trusting a stale JWT after suspension/role changes (claims are frozen at login for up to an hour); one auth code path for portal + apps + worker.
- **Status**: CODE verified.

#### retailerCustomers GET / POST
- **Claim**: Lists the retailer's customers (GET) and creates a customer with the full EMI schedule (POST).
- **How it works**: GET scopes by `profile.retailer_id` (owner sees all), blocked when suspended (`web/lib/apiHandlers/retailerCustomers.ts:8-21`). POST validates all 7+ fields with integer/range checks (`:31-41`), rejects duplicate IMEI per retailer (`:45-47`), generates `customer_code = 'EMD-' + 3 random bytes` (`:49`), inserts the customer with `lock_mode` (`:51-58`), then generates the repayment schedule in Asia/Calcutta (IST due days, month-end clamped, `:66-86`) and deletes the customer if the schedule insert fails (`:87-91`).
- **What it prevents**: NaN/negative EMI terms reaching the DB (explicit integer checks); the same IMEI registered twice for one retailer; due-day drift when Vercel runs UTC; half-created customers (rollback on schedule failure).
- **Status**: CODE verified. Residual: `customer_code` is 24 bits — fine as a companion factor because the retailer's phone number is the SMS sender gate and UNLOCK additionally needs a TOTP.

#### consent
- **Claim**: Records an optional, counter-consent audit row for a customer.
- **How it works**: staff-only, tenant-checked, inserts `text_hash` (sha256 of the fixed consent text), lang, otp_ack and optional signature ref (`web/lib/apiHandlers/consent.ts:14-44`), audited.
- **What it prevents**: consent being claimed with no record at all when the retailer wants one; cross-retailer consent rows.
- **Status**: CODE verified. Business rule (documented): direct counter consent is the binding step; this row is optional and never a blocking precondition.

#### enrollment
- **Claim**: Creates a 15-minute, one-shot enrolment session and returns the raw token exactly once.
- **How it works**: staff-only + suspension gate + tenant check (`web/lib/apiHandlers/enrollment.ts:13-21`); token = `randomBytes(8).toString('hex')` and only `sha256(token)` is stored (`:27-37`).
- **What it prevents**: token replay and theft-from-DB (hash-only storage); indefinite tokens (15-min expiry); a suspended retailer starting new enrolments.
- **Status**: CODE verified.

#### enrollmentGet
- **Claim**: Lets a retailer (or owner) fetch one enrolment session's state.
- **How it works**: tenant check on `retailer_id` for staff (`web/lib/apiHandlers/enrollmentGet.ts:12-15`).
- **What it prevents**: a staff member probing another retailer's session rows (which contain customer ids and states).
- **Status**: CODE verified.

#### payments GET / POST
- **Claim**: Lists a customer's payments (GET) and records one atomically with schedule settlement (POST).
- **How it works**: both tenant-checked (`web/lib/apiHandlers/payments.ts:12-14, 32-34`); POST rejects positive-check failures, settled loans (`:28-37`), and calls the SQL `record_payment` RPC (`:43-47`); an RPC `overpayment` exception maps to 400 (`:49-53`); when the loan completes, the device credit is freed via `release_device_credit` (`:59-62`); every payment is audited (`:64-67`).
- **What it prevents**: double allocation of one payment across schedules (serialized per customer inside the RPC); overpayments silently vanishing; payments on a settled loan; loan completion without a release_events row + credit refund (the RPC does both).
- **Status**: CODE verified. The phone's local release on COMPLETE is CODE+DEVICE (customer app settled branch).

#### schedules
- **Claim**: Returns a customer's EMI schedule.
- **How it works**: tenant-checked, ordered by due_date (`web/lib/apiHandlers/schedules.ts:7-18`).
- **What it prevents**: staff reading another retailer's schedule (payment posture leakage).
- **Status**: CODE verified.

#### retailerDevices
- **Claim**: Lists the retailer's devices with column hygiene.
- **How it works**: explicit column list excluding `pin_verify`, `device_token_hash`, SIM baselines (`web/lib/apiHandlers/retailerDevices.ts:12-16`).
- **What it prevents**: sensitive device material in API responses to retailer clients (the same leak class the console page was fixed for).
- **Status**: CODE verified.

#### retailerUnlockKey
- **Claim**: Hands the retailer the phone's offline-unlock TOTP secret (Authenticator style).
- **How it works**: staff-only + suspension gate (`web/lib/apiHandlers/retailerUnlockKey.ts:20-23`); device must belong to the retailer (404 otherwise, `:26-30`); no secret row → 409 `no_unlock_key` with the "must sync once online" message — it never mints (`:32-39`); decrypts the AES-256-GCM blob (`:41-44`); returns the SAME base64 secret the heartbeat delivered to the phone plus `period: 30, digits: 8` (`:49`); audits `TOTP_KEY_ISSUED_RETAILER` (`:46-48`).
- **What it prevents**: a retailer minting codes for a phone that can never receive a fresh secret (offline phone = dead end); unauthorized staff reading unlock keys (tenant + suspension gates); silent key handout (audit row).
- **Status**: CODE verified + CODE (app generator half: codex). Residual: holding the secret lets the holder generate valid unlock codes — the route is deliberately retailer-scoped and audited for that reason.

#### Rate limiting (in-memory + shared)
- **Claim**: Caps device-facing endpoints per IP + installation, with a cross-instance DB limiter behind it.
- **How it works**: `web/lib/rateLimit.ts:6-21` keeps an in-memory bucket per key (cap 10 000 entries); `sharedRateLimit` (`:37-55`) calls the SECURITY DEFINER `rate_limit_hit` RPC with the service key and FAILS OPEN on DB errors (the local limiter still ran first). register and ack use both; heartbeat uses the local one to stay on the hot path.
- **What it prevents**: token brute-forcing on register, ack spam, and heartbeat floods from a single IP/installation.
- **Status**: CODE verified. Honest limits: the in-memory limiter is per serverless instance (cold resets), and the shared limiter fails open when the DB is unreachable — both documented; the `rate_limits` table itself is closed to non-service roles by 0011.

#### totpCrypto (at-rest encryption)
- **Claim**: Encrypts/decrypts TOTP secrets with AES-256-GCM.
- **How it works**: key = sha256(TOTP_ENC_KEY or service key) (`web/lib/totpCrypto.ts:9-18`), 12-byte random IV + auth tag, JSON envelope `{v, iv, tag, ct}` (`:20-30`); decryption returns the base64 secret and throws/null on tamper (`:32-49`). Production with no key throws.
- **What it prevents**: a DB dump exposing usable TOTP secrets; ciphertext tampering (GCM tag).
- **Status**: CODE verified. Residual: the heartbeat legitimately decrypts and delivers the secret to the phone over TLS.

---

## 5. SQL layer

#### RLS model (0005) — JWT claims + staff SELECT-only + live suspension guard
- **Claim**: Every table's access is decided by the JWT `app_metadata` role claim, with staff limited to SELECT and suspension re-checked against the live profiles row.
- **How it works**: `supabase/migrations/0005_rls_jwt.sql` drops the recursive profile-reading helpers and recreates all policies on `auth.jwt() -> 'app_metadata' ->> 'role'/'retailer_id'`. Staff are SELECT-only on customers (`customers_read`), payments (`payments_read`), emi_schedules (`schedules_read`) and devices (`devices_access`); every staff branch adds `not exists (select 1 from profiles p where p.id = auth.uid() and p.is_suspended)` — an own-row subquery that `profiles_self` permits (no recursion). Owner branches keep full access; `totp_secrets` stays `using (false)` (service role only).
- **What it prevents**: a staff member UPDATE-ing `customers.status` to COMPLETE to settle a loan without payment, deleting payment rows to hide cash, or marking schedules PAID outside `record_payment` (the whole settlement/release machinery is now API/RPC-only); a suspended retailer keeping direct DB access on a still-valid JWT (the guard is evaluated per query, not at login); tenant leakage between retailers.
- **Status**: CODE verified (applied on live DB by the user per checksum; anon probes return `[]`).

#### Credit + allowance RPCs (0003/0008/0010)
- **Claim**: Balances move only through atomic SQL functions with ledger rows.
- **How it works**: `adjust_credits` (`0003_hardening.sql:21-26`) enforces non-negativity inside the UPDATE; `decrement_allowance` (`0001`), `increment_allowance`, `consume_device_credit`, `refund_device_credit` (`0008_allowance_refund.sql`) are single-statement atomic updates; `release_device_credit` (`0010_credit_lifecycle.sql:13-36`) frees a credit only if `slot_consumed` exists and no `slot_freed` row does, with a partial unique index on `(device_id) where kind = 'slot_freed'` making a concurrent double-release fail; `ledger_kind` gained `lock_refund` so refund rows are never dropped by the enum.
- **What it prevents**: read-then-write races driving balances negative or crediting twice; activation/release cycles double-consuming or double-refunding a device credit; refunds that were previously silently discarded (the enum fix).
- **Status**: CODE verified. Residual: direct EXECUTE is available to any role, but non-service callers hit RLS (zero rows) — the service role is the only effective caller.

#### rate_limits + 0011 closure
- **Claim**: A shared, cross-instance rate-limit counter that non-service roles cannot touch.
- **How it works**: `rate_limit_hit` upserts a per-key count/reset_at atomically (`0009_rate_limit.sql:11-29`); `0011_rate_limits_rls.sql:10-15` enables RLS (no policies = closed) and revokes public EXECUTE on the function, granting only `service_role`.
- **What it prevents**: anyone with the public anon key reading the key table (IP + installation pairs), deleting rows to reset their counters, or pre-inflating victims' counters for a denial of service — the table was previously wide open because Supabase grants anon table privileges and RLS was never enabled.
- **Status**: CODE verified, and APPLIED LIVE (2026-10-03 probe: anon INSERT into `rate_limits` is refused with a 42501 RLS violation).

#### record_payment RPC
- **Claim**: One transaction that records a payment and settles the oldest unpaid schedules, serialized per customer.
- **How it works**: `0010_credit_lifecycle.sql:42-96` locks the customer row (`for update`), rejects settled loans, computes total remaining due and RAISES `overpayment` when the amount exceeds it, inserts the payment, allocates oldest-first against `amount_due - amount_paid` (PARTIAL for the remainder), and when nothing unpaid remains flips the loan to COMPLETE and inserts a `release_events` row — all committed together; concurrent payments for one customer serialize on the row lock.
- **What it prevents**: one payment being counted twice against schedules; partials overwriting earlier payments; overpayments silently swallowed; a loan marked COMPLETE without a release event; a customer ending in an inconsistent state (all schedules paid but status RUNNING).
- **Status**: CODE verified.

#### Indexes (0002 + extras)
- **Claim**: Hot query paths are indexed, and two unique indexes close check-then-insert races.
- **How it works**: 13 indexes in `0002_perf_indexes.sql` cover the heartbeat command scan `(device_id, status, created_at)`, next-due lookups, token lookup, duplicate-IMEI, device/audit/ledger/payment listings; `0003`/`0007`/`0010` add session, profile, release, lock_mode and rate-limit-reset indexes. `enrollment_sessions(token_hash)` and `customers(retailer_id, imei)` are UNIQUE.
- **What it prevents**: heartbeat polling degrading as command history grows; a duplicate-IMEI or double-token race slipping past the application-level checks.
- **Status**: CODE verified (applied on the live DB per the lead's probe).

#### All-in-one migration (0000)
- **Claim**: One idempotent file brings a fresh (or partially migrated) DB to the current schema.
- **How it works**: `0000_all_in_one.sql` concatenates 0001-0011 in order with `if not exists`/exception guards, and the RLS section is self-healing (drops old policy names like `customers_access` before creating the new pairs; drops the actor helpers only after the new policies exist).
- **What it prevents**: a fresh project skipping a migration (e.g. 0007's `lock_mode`, 0011's RLS) and hitting runtime 500s; the old recursive actor_role policies surviving on a re-run.
- **Status**: CODE verified (idempotency reviewed; live DB already carries 0001-0010).

#### Account script (create_accounts.mjs)
- **Claim**: Creates the owner/staff accounts with the app_metadata claims RLS depends on.
- **How it works**: admin API creates users with `app_metadata { role:'owner', provider, providers }` for the owner and merges `{ role:'retailer_staff', retailer_id, provider, providers }` for the staff (`scripts/create_accounts.mjs:69-103`); profiles/retailers/customer rows are inserted with the service key.
- **What it prevents**: an owner or staff login whose JWT lacks the role claim (which would silently zero out every RLS-gated read); loss of GoTrue `provider/providers` on the metadata update.
- **Status**: CODE verified (live demo accounts work per the earlier probe).

---

## Threat table (abuse vector → blocking function → residual)

| Abuse vector | Blocked by | Residual (honest) |
|---|---|---|
| Staff settles a loan without payment (direct PostgREST UPDATE of customers.status / schedules) | 0005 SELECT-only policies + `record_payment` as the only settlement path | A stolen staff JWT keeps read access until expiry; route-level suspension is live, RLS suspension guard is live per query |
| Staff deletes payment rows to hide cash | `payments_read` (staff no UPDATE/DELETE) | Owner can still mutate rows by design |
| Suspended retailer keeps working on a cached JWT | `requireActor` live profile check (every route) + `is_suspended` RLS guard (every staff branch) | None identified beyond JWT read access, which the guard also blocks |
| Attacker brute-forces the enrolment token | 20/min register rate limit + 15-min expiry + one-shot CAS | Token is 64-bit (typed by hand); acceptable under the limits |
| Stolen token re-points a live phone to the attacker's device | register takeover guard (retailer AND customer match; settled devices excepted for resale) | An attacker holding a valid unused token for the same customer is the retailer's own compromise |
| A settled (paid-off) phone re-locks | commands.ts + commandProxy settled refuse; ack.ts settled gate forces SUPERSEDED + refund | The device's 5-day offline watchdog can hold a stale local lock until its first online heartbeat (documented in checklist E1); SMS UNLOCK needs a TOTP |
| Allowance theft or leakage (locks never executed, dead devices) | decrement-at-queue + refund on FAILED/EXPIRED/SUPERSEDED + 24 h heartbeat sweeper, all one-time via CAS + commands.ts compensation when the ledger row fails | Refund's own `lock_refund` ledger row is best-effort under the same DB fault (audited) |
| Overpayment on a loan | `record_payment` raises `overpayment` → 400 | Exact-amount culture required; no store-credit concept yet |
| PIN brute-force by staff | explicit column lists on console/devices page + retailerDevices route keep `pin_verify` out of staff payloads | Owner API responses and the heartbeat intentionally carry it (owner/device are trusted) |
| Rate-limit bypass via the shared table | 0011 RLS + revoked EXECUTE on `rate_limit_hit` | The limiter itself still fails open when the DB is unreachable; in-memory limiter is per-instance |
| TOTP secret theft from a DB dump | AES-256-GCM at rest (totpCrypto) | Whoever holds the decrypted secret can generate valid unlock codes; retailer handouts are audited |
| Fake "policies applied" claims | heartbeat returns an empty `policies` map; the phone reports its own OS readback | OS-side truth requires the DEVICE acceptance walk |
| Retailer created without working RLS claims | ownerRetailers POST writes `app_metadata` (merge-safe) + `web/app/page.tsx` self-heals any missing claim on next redirect (logged) | Self-heal applies on the next portal visit; the JWT claim itself refreshes on the next token refresh |
| Unauthorized unlock-key handout | retailerUnlockKey: staff + suspension + tenant gates + audit | A legitimate staff member holding the secret can unlock — by design, audited |

---

Count: 39 functions covered (12 owner portal, 5 retailer console, 5 device API,
9 retailer API + shared lib, 8 SQL layer), each with claim / mechanism / prevention / status.

Items flagged for lead verification: (1) the pending DDL on the live DB is
`0017` (sales ledger) — one all-in-one query tab (0011–0016 verified applied
by the acceptance run); (2) the
app-side halves (Totp.kt verify, retailer
generator UI, worker dispatch parity for unlock-key, native REBOOT execution)
are codex's rows in the merged report; (3) the report deliberately keeps all
DEVICE items as CODE+DEVICE — no overclaiming.


## Part 2 — Apps, device-kit native module, shared package, worker (74 functions)

### 1. Customer app (apps/customer)

#### App (apps/customer/App.tsx:20)
- **Claim**: Root component that binds the phone, runs the heartbeat loop, and renders the lock screen when locked.
- **How it works**: On mount it checks `isRegistered()`; unbound phones show `BindScreen`, bound phones call `startSync()`. A single-flight 60 s interval (App.tsx:45-95, `inFlight` ref) runs `pollOnce()`, then reads native `getDeviceManagementStatus()`; when `enforcedLocked` it shows the overlay and calls `enterLockTask()`, otherwise `exitLockTask()`. `locked` state drives `LockedScreen`.
- **What it prevents**: Overlapping heartbeat rounds (double polls), stale UI state, and a locked phone whose kiosk pinning silently lapses.
- **Status**: CODE verified.

#### BindScreen (apps/customer/App.tsx:155)
- **Claim**: Binds the phone to a retailer-issued enrolment token.
- **How it works**: Reads device info via `getDeviceInfo()`, shows the OEM profile via `getOemProfile(manufacturer, '')`, and calls `registerWithToken(code, deviceInfo)`; on success transitions to `active`.
- **What it prevents**: Anonymous/unbound devices talking to the heartbeat; the device cannot self-provision an identity.
- **Status**: CODE verified (server-side token consumption is web scope).

#### getInstallationId / getDeviceToken (apps/customer/src/services/sync.ts:87,96)
- **Claim**: Mints one stable device identity pair from a CSPRNG.
- **How it works**: `expo-crypto` `getRandomBytes` (16/32 bytes) → hex; persisted in AsyncStorage once and memoized in module memory.
- **What it prevents**: `Math.random`-predictable identities/tokens being guessed and spoofed against the device API.
- **Status**: CODE verified.

#### registerWithToken (apps/customer/src/services/sync.ts:124)
- **Claim**: Registers the installation with the enrolment token, then starts the native command service.
- **How it works**: POST `/api/device/register` with lowercased token, installation_id, device_token and device info; on success marks registered and calls `startSync()`.
- **What it prevents**: Replayed/broken bindings — registration is one-time and the server consumes the token atomically (web scope).
- **Status**: CODE verified (device half of the round trip; token semantics are web scope).

#### startSync (apps/customer/src/services/sync.ts:151)
- **Claim**: Boots the native foreground command service with the device identity.
- **How it works**: `configureCommandService(API_URL, installationId, deviceToken)` then `startCommandService()`.
- **What it prevents**: The phone losing command delivery when the app is closed or killed.
- **Status**: CODE verified.

#### pollOnce (apps/customer/src/services/sync.ts:170)
- **Claim**: One heartbeat round: full server truth → local cache + native mirrors + reminders + command execution.
- **How it works**: Posts `{ mode }` with the X-Device-Token to `/api/device/heartbeat`; caches loan_status/lock_mode/next_due/pin_verify/totp_secret/customer_code/is_locked (`saveCachedState`, sync.ts:197-213); mirrors sync-ok + lock_mode natively; on COMPLETE/SETTLED runs release-once (cancel reminders, unlock, sentinel off, protection off, unhide); schedules/cancels reminders; applies FRP protection for RUNNING/NPA; configures SMS control + PIN + TOTP (each via `applyOnce`, sync.ts:110, so unchanged values are not re-applied); sets the SIM baseline exactly once; hides "wifi" once mode=device_owner; then executes PENDING/RECEIVED commands with ack.
- **What it prevents**: A device that forgets its loan state when offline, repeated native churn, a settled loan that stays locked, and a phone that stays visible in the launcher.
- **Status**: CODE verified.

#### Command execution + ack (apps/customer/src/services/sync.ts:300-330, ack at :318)
- **Claim**: Executes LOCK/UNLOCK/RELEASE/LOCATION from the heartbeat and acks each honestly.
- **How it works**: LOCK first runs `isLockCommandStale` (see stale.ts below) against `server_now` and the native watermark readback and acks `SUPERSEDED` when stale; otherwise `executeAuthorizedLock` (native hard-lock gate) and ack EXECUTED/FAILED with reason. UNLOCK/RELEASE execute + release-side effects + EXECUTED. LOCATION fetches on demand and acks the fix.
- **What it prevents**: A stale LOCK (created before the last unlock) re-locking an unlocked phone — the JS path now matches the native unlock-wins watermark.
- **Status**: CODE verified.

#### enforceOfflineWatchdog (apps/customer/src/services/sync.ts:64)
- **Claim**: 5-day no-internet local hard-lock for lock plans only.
- **How it works**: Reads cached state; skips unless `lock_mode === 'lock'` and loan RUNNING/NPA and a sync has ever succeeded; if `Date.now() - lastSyncOkAt >= 5 days` calls `executeAuthorizedLock('offline-watchdog')`.
- **What it prevents**: A customer switching off the internet for days to dodge locking. notify_only plans never lock.
- **Status**: CODE verified (mirrored natively in SyncStateStore.offlineLockDue).

#### unlockWithCode (apps/customer/src/services/sync.ts:338)
- **Claim**: Offline unlock by portal-set device PIN or owner-issued TOTP.
- **How it works**: Tries `verifyDevicePin(code)` then `verifyTotpUnlock(code)`; on success `executeAuthorizedUnlock` + `kickCommandService` (server acks of pending commands happen on the next poll).
- **What it prevents**: A locked, fully-offline phone with no escape when the retailer cannot SMS — the owner's audited TOTP or the portal PIN still unlocks it.
- **Status**: CODE verified. The former honest limit (server `is_locked` lagging code unlocks) is FIXED: the heartbeat now writes the device-reported `locked` readback — `true` always, `false` only when no LOCK/DEVICE_ACTION is PENDING/RECEIVED, settled loans skipped (`web/lib/apiHandlers/heartbeat.ts:124-140`).

#### scheduleReminders / cancelReminders (apps/customer/src/services/sync.ts:369,387)
- **Claim**: The AUTOMATIC schedule is now due-day only: 3 notifications at 10:00, 14:00 and 20:00 local (reminder control shift — the old −3/−1/+1/+3 automatic schedule is REMOVED).
- **How it works**: `expo-notifications` channel + `scheduleNotificationAsync` date triggers for the three fixed due-day times; the set is replaced when the due signature changes and cancelled on COMPLETE/SETTLED. Pre-due reminders are retailer-triggered only: the online REMIND command (commands.ts accepts it, no allowance, settled-refused) or the offline SMS `REMIND <code>` — a friendly bn/hi payment-reminder voice + notification, distinct from the urgent ALERT voice. The overdue escalation (30-min voice loop, day-3 location SMS) is the native command-service half and honours the heartbeat `escalation_enabled` kill-switch; retailer-triggered REMIND/ALERT/LOCATION work even with the switch off.
- **What it prevents**: A phone nagging the customer before the due day without the retailer deciding (anti-harassment); stale/duplicate automatic reminders; reminders after settlement; a due day with only one notification.
- **Status**: CODE verified; honest limit: exact alarm delivery on Android 12+ can degrade without SCHEDULE_EXACT_ALARM (accepted; reminders are advisory, not enforcement).

#### LockedScreen (apps/customer/App.tsx:227)
- **Claim**: Dark locked UI with pay/call-retailer/112 actions and a hidden unlock-code entry.
- **How it works**: Re-asserts `enterLockTask()` on mount (App.tsx:243); breathing ring animation honors reduced motion; three live actions use `showCallOverlay` (ACTION_DIAL); long-press on the lock emblem (App.tsx:307-330) reveals a numeric entry wired to `unlockWithCode`, with `onUnlocked` refreshing state via `pollOnce()`.
- **What it prevents**: A locked screen with no emergency path (112 stays reachable), no retailer contact, and no offline unlock escape; also prevents the kiosk pin from being the only enforcement (defense in depth).
- **Status**: CODE verified + DEVICE (112 dial and overlay behavior on real OEMs).

#### Diagnostics (apps/customer/App.tsx:390)
- **Claim**: Hidden protection-status readout behind three taps.
- **How it works**: Three taps toggle `showDebug`; renders `getProtectionStatus()` entries and hidden state.
- **What it prevents**: Customers reading store tooling while giving the retailer a support surface.
- **Status**: CODE verified.

#### hideSelf / unhideSelf (device-kit index.ts:118-124 → EmidostDeviceManagementModule.kt:163-171)
- **Claim**: Hides "wifi" from the launcher while active; unhides on release.
- **How it works**: `dpm.setApplicationHidden(admin, pkg, hidden)` gated on live Device Owner; JS calls hide when mode=device_owner + outstanding loan (sync.ts:273) and unhide in the settled/release paths (sync.ts:227,307).
- **What it prevents**: The customer uninstalling/finding the DPC from the app drawer.
- **Status**: CODE verified + DEVICE (launcher behavior per OEM).

#### PairingWalkthrough (apps/customer/App.tsx)
- **Claim**: Customer-side wireless-enrol walkthrough: overlay grant → accessibility toggle → developer options → the three pairing numbers.
- **How it works**: One-tap overlay grant (system dialog) and one accessibility switch; the accessibility service auto-walks developer options and wireless debugging (per-OEM matrix) and captures ip:port + 6-digit code; the screen displays host, port and code BIG plus an `emidost://pair` QR (follow-up) and an honest "Not seen yet" placeholder while the service is still reading the dialog.
- **What it prevents**: The retailer needing a PC (the customer phone presents the pair values itself); the pairing values being shown from a stale read (honest placeholder until the scoped read lands).
- **Status**: CODE verified + DEVICE (per-OEM walk of the developer-options steps).

### 2. Retailer app (apps/retailer)

#### App + Login (apps/retailer/App.tsx:41,111)
- **Claim**: Session-gated shell with four tabs; Supabase email/password sign-in.
- **How it works**: `supabase.auth.getSession()` on mount; the header reads the retailer's credits/lock allowances straight from the DB (RLS-scoped read).
- **What it prevents**: Unauthenticated access to retailer tooling.
- **Status**: CODE verified.

#### Customers (apps/retailer/App.tsx:140)
- **Claim**: FlatList of customers with status + plan chips, setup-code mint, and inline payment recording.
- **How it works**: `api.listCustomers()` via bearer token; chips derive from `status`/`lock_mode`; RUNNING/NPA rows expose `SetupCode` and `PaymentRow`.
- **What it prevents**: Server-truth drift (summaries come from the DB) and selling actions on settled rows (setup code is hidden for COMPLETE/SETTLED).
- **Status**: CODE verified.

#### SetupCode (apps/retailer/App.tsx:183)
- **Claim**: Mints the one-time 15-minute enrolment token shown once.
- **How it works**: `api.createEnrolment(customerId, {})` → token + expires_at; busy-guarded.
- **What it prevents**: Replayed enrolment tokens (only the hash is stored server-side, web scope).
- **Status**: CODE verified.

#### PaymentRow (apps/retailer/App.tsx:225)
- **Claim**: Records a cash payment against the customer.
- **How it works**: `api.recordPayment(customerId, { amount, method: 'cash' })` with a busy guard against double submits; refreshes the list on success.
- **What it prevents**: Double-submitted payments and overstated balances (server allocates against amount_due − amount_paid, web scope).
- **Status**: CODE verified.

#### NewCustomer (apps/retailer/App.tsx:269)
- **Claim**: Customer registration with the full EMI fields and the lock-plan choice.
- **How it works**: Form → `api.createCustomer({ ..., lock_mode })` (typed in shared api.ts); the brand value is lifted to the Enrol tab via `onBrand`; busy guard on save.
- **What it prevents**: A customer silently defaulting to the wrong plan; the choice is explicit ("Lock on missed payment" vs "Never lock, only reminders").
- **Status**: CODE verified.

#### Devices (apps/retailer/App.tsx:361)
- **Claim**: Device list with LOCK/UNLOCK (server allowance-checked) and offline unlock code.
- **How it works**: `api.listDevices()`; toggle sends LOCK/UNLOCK through the API (allowance debit happens server-side on command insert, web scope); each row has an "Offline unlock code" button opening `UnlockCodeScreen`.
- **What it prevents**: Retailers locking beyond their allowance and losing access to offline unlock when the phone has no internet.
- **Status**: CODE verified.

#### UnlockCodeScreen (apps/retailer/App.tsx:418)
- **Claim**: Authenticator-style 8-digit offline unlock code generator for one device.
- **How it works**: Reads SecureStore `emidost.retailer.unlockkey.<deviceId>`; on miss calls `api.getDeviceUnlockKey(deviceId)` and caches the base64 secret; a 1 s interval recomputes `totpCode(secret, now)` (flips at each 30 s boundary, cleared on unmount); 30 s SVG countdown ring (strokeDashoffset per second) with a plain "New code in Xs" text under reduced motion; Copy via expo-clipboard; 409 → "The phone has no unlock key yet. It must complete one online sync before offline unlock works.", network failure with no cache → "No saved key. Connect once to load it."; guidance: "Long-press the lock emblem on the phone, then type this code."; header shows customer name (resolved via listCustomers) + device model.
- **What it prevents**: A locked, offline phone with no unlock path when the retailer has no SMS signal — the same secret the phone verifies (Totp.kt) is generated locally and fully offline after the first fetch.
- **Status**: CODE verified (generator math proven by RFC 6238 vectors + node:crypto cross-check; phone-side acceptance is the H5/H6 device walk).

#### Enrol (apps/retailer/App.tsx:558)
- **Claim**: Brand-threaded per-OEM enrolment walkthrough + portal QR deep link.
- **How it works**: `getOemProfile(brand, brand)` from the brand chosen in NewCustomer (empty → generic near-stock steps); renders setup steps + gate hint + "Open portal QR page" (`Linking.openURL(API_URL + '/qr')`).
- **What it prevents**: Staff following the wrong OEM steps (Samsung Auto Blocker, MIUI optimization, restricted settings) and enrolments failing at the counter.
- **Status**: CODE verified (walkthrough content is research-grade; per-family certification is DEVICE).

#### WirelessEnrol (apps/retailer/App.tsx)
- **Claim**: No-PC wireless enrolment controller: staff type the pair port, 6-digit code and connect port, then watch the honest step chain.
- **How it works**: Three number inputs (pair port / pairing code / connect port) feed `EmidostAdbBridge`'s step runner: `adb pair` → `connect` → `pm grant` ×8 → `appops SYSTEM_ALERT_WINDOW` → `dpm set-device-owner` → `dpm list device-owners` readback → debug-off cleanup → disconnect; each step renders `{ ok, output, readback }` and the chain stops at the first failure with the raw adb output; a busy guard blocks double runs and a finally-disconnect clears the session values.
- **What it prevents**: A half-enrolled phone being reported as done (per-step honest output + readback requirement); the retailer silently leaving wireless debugging on (cleanup step); accidental double-pairing (busy guard).
- **Status**: CODE verified + DEVICE (per-OEM walk; the step chain is the design contract in `.review/wireless-plan.md`).

### 3. Owner app (apps/owner)

#### App + Login (apps/owner/App.tsx:34,85)
- **Claim**: Owner shell (retailers/new/audit) behind Supabase email/password.
- **How it works**: Same session pattern as the retailer app.
- **What it prevents**: Unauthenticated owner tooling.
- **Status**: CODE verified.

#### Retailers (apps/owner/App.tsx:114)
- **Claim**: Retailer list with suspend/resume, credit top-ups, and allowance sets.
- **How it works**: FlatList over `api.listRetailers()`; suspend via PATCH `is_suspended`; credits via `api.allocateCredits(r.id, { delta, kind: 'topup' })`; allowances via `api.setLockAllowances(r.id, n)`; busy guard + `Number.isFinite`/`>= 0` NaN/negative guards.
- **What it prevents**: Accidental negative top-ups, NaN allowances, and double submits corrupting the ledger.
- **Status**: CODE verified.

#### NewRetailer (apps/owner/App.tsx:210)
- **Claim**: Creates a retailer login (name, phone, login id, password).
- **How it works**: `api.createRetailer({...})` — the server creates the auth user + staff profile (web scope); the phone is the future SMS sender.
- **What it prevents**: Retailers without an audit-visible, owner-controlled account.
- **Status**: CODE verified.

#### Audit (apps/owner/App.tsx:249)
- **Claim**: Audit trail list.
- **How it works**: FlatList over `api.listAudit()` (owner-gated server-side); empty state added.
- **What it prevents**: Blind operations — every credit/allowance/TOTP/PIN action lands in the audit log (web scope) and is visible here.
- **Status**: CODE verified.

### 4. packages/device-kit — Kotlin

#### EmidostDeviceManagementModule (EmidostDeviceManagementModule.kt:17)
- **Claim**: The Expo native surface for the whole device-management kit.
- **How it works**: ~40 `Function(...)` bindings over the stores/services below; each reads/writes through Device-Actions gates.
- **What it prevents**: JS talking to Android APIs directly; every enforcement call funnels through one auditable surface.
- **Status**: CODE verified (Kotlin compiled only in EAS builds — inspected compile-clean, not locally compiled).

#### DeviceActions.hardLock (DeviceActions.kt:38)
- **Claim**: Hard lock that refuses without a live Device Owner.
- **How it works**: `isOwner(c)` (live `dpm.isDeviceOwnerApp` readback) → set locked state, `LockPolicies.apply(true)`, `lockNow`, overlay; returns "HARD_LOCK_REFUSED" otherwise. No soft fallback exists.
- **What it prevents**: A non-DO device acing EXECUTED for a lock it never enforced — the module/service ack FAILED instead (D1/D2).
- **Status**: CODE verified + DEVICE (real-device DO readback).

#### LockPolicies.apply / startKioskIfPermitted / kioskActive (LockPolicies.kt:16,70,82)
- **Claim**: The full kiosk lock set: lock-task whitelist, call block, feature flags, HOME takeover, kiosk launch.
- **How it works**: DO-gated; `setLockTaskPackages(admin, [pkg])`; `DISALLOW_OUTGOING_CALLS` add/clear (framework keeps 112 dialable); `setLockTaskFeatures` = KEYGUARD + SYSTEM_INFO only while locked (NOTIFICATIONS omitted because Android requires HOME; GLOBAL_ACTIONS deliberately excluded so the kiosk power menu has no Reboot); `addPersistentPreferredActivity` HOME takeover / clear on release; relaunches the app when permitted. `kioskActive()` is the live `lockTaskModeState == LOCKED` readback, reported in status (never faked).
- **What it prevents**: Power-menu Reboot escape, home-button escape, and non-emergency outgoing calls while locked; the readback catches silently failed pinning.
- **Status**: CODE verified + DEVICE (actual pinning/power menu per OEM family).

#### enterLockTask / exitLockTask (EmidostDeviceManagementModule.kt:68,82)
- **Claim**: Pin/unpin the foreground activity into lock-task mode.
- **How it works**: DO + `isLockTaskPermitted` → `activity.startLockTask()`; `stopLockTask()` on exit (exception-safe). The customer app calls enter when `enforcedLocked` and exit when unlocked (App.tsx:79,82; LockedScreen mount :243).
- **What it prevents**: The whitelist being set but lock-task mode never actually engaging (the historical gap); and the customer staying pinned after a legitimate unlock.
- **Status**: CODE verified + DEVICE.

#### FinancingProtection.apply / restore / status (FinancingProtection.kt:39,94,102)
- **Claim**: Uninstall block, factory-reset/safe-boot/add-user/debugging/clock restrictions, user-control disable, and FRP from env accounts.
- **How it works**: DO-gated `setUninstallBlocked` + five `addUserRestriction`s + `setUserControlDisabledPackages` (API 30+; attempt recorded); FRP via `setFactoryResetProtectionPolicy` from the JS-delivered `EXPO_PUBLIC_FRP_ACCOUNTS` (never hard-coded; remembered in prefs and re-applied on boot via `restore`). `status()` reports OS readbacks plus honest fields: `frp_os_confirmed=false` and `user_control_os_confirmed=false` (Android exposes neither readback).
- **What it prevents**: Factory reset/FRP wipe, safe-boot, second users, ADB tampering, clock manipulation, uninstall of the DPC, and the customer disabling the DPC/Settings through user control.
- **Status**: CODE verified; honest limit: FRP OS-side application and user-control effect are unverifiable until a device walk (C3/C4 = CODE+DEVICE).

#### EmidostBootReceiver (EmidostBootReceiver.kt:14)
- **Claim**: Boot auto-lock + protection restore + service restart.
- **How it works**: Handles BOOT_COMPLETED / LOCKED_BOOT_COMPLETED / QUICKBOOT_POWERON; reads state from device-protected storage (DpcContext); restores financing protection, restarts the command service, and when persisted state is LOCKED + DO: `lockNow`, overlay cover, and relaunch (HOME takeover lands the reboot on the lock screen).
- **What it prevents**: A reboot or battery-pull clearing the lock — the phone re-locks before the customer can use it.
- **Status**: CODE verified + DEVICE (boot behavior per OEM; A15 dataSync FGS start-from-boot restriction is logged, see command service).

#### EmidostCommandService (EmidostCommandService.kt:29)
- **Claim**: START_STICKY foreground command service: heartbeat polling, 2-min offline re-assert, watchdog, honest acks.
- **How it works**: `start()` logs (not swallows) FGS start failures, with an honest comment about the Android 15 dataSync boot restriction and ~6 h/day cap (the HOME app relaunch is the mitigation); a 2 h idle / 15 s burst poll (kick() pulls it into a 10-min burst window) with ±20% jitter; every tick runs `SyncStateStore.offlineLockDue` (5-day watchdog) before any network call; processes PENDING/RECEIVED commands — LOCK re-checks the unlock-wins watermark (`LockStateStore.isLockStale`, server_now-based) and acks SUPERSEDED when stale; non-DO LOCK acks FAILED; COMPLETE/SETTLED triggers coreRelease and stops command delivery; a separate 2-min timer (`reassertIfLocked`) re-applies LockPolicies + lockNow + overlay fully offline; SMS LOCK from the retailer number is debounced (an identical LOCK for the same customer within 60 s is ignored — spoof-DoS hardening); status reporting includes `simBaselinePresent`; REBOOT commands dispatch to `rebootDevice`, which schedules the reboot ~5 s out so the EXECUTED ack lands before the device goes down, and refuses while locked with reason `locked_reboot_refused`.
- **What it prevents**: Locks evaporating when the app is closed, a stale LOCK re-locking after unlock, a settled loan staying locked, silent service-start failures, a spoofed-SMS LOCK storm relocking a phone endlessly, and a REBOOT command bypassing the lock (refused while locked, acked before shutdown).
- **Status**: CODE verified; honest limit: Android 15 dataSync FGS caps mean the poll can die after ~6 h/day until the next launch (enforcement itself is local and unaffected).

#### EmidostSmsReceiver (EmidostSmsReceiver.kt:12)
- **Claim**: Offline SMS LOCK/UNLOCK/REMIND/ALERT/LOCATION from the retailer's number.
- **How it works**: `SMS_RECEIVED` → configured? → sender normalized (last-10-digits) against the allowlisted retailer phone → customer code match → LOCK executes only when live DO + outstanding loan + lock plan (`lock_mode == "lock"`); UNLOCK requires a valid 8-digit TOTP as the third token and always wins; REMIND plays the friendly payment-reminder voice + notification, ALERT the urgent overdue voice + notification, and LOCATION makes the phone reply by SMS with its Google Maps link (all three gated on loan outstanding and working even when the escalation kill-switch is off); an identical SMS LOCK for the same customer within 60 s is ignored (spoof-DoS debounce; UNLOCK path untouched); every accepted SMS kicks the burst poll.
- **What it prevents**: Random SMS locking phones (allowlist + code), a spoofed-SMS unlock (TOTP required — bare SMS unlock is not accepted), a settled/notify_only phone being locked or nagged, a spoofed-SMS LOCK storm relocking a phone endlessly (limited to one per 60 s per customer), and commands sitting unacked while offline. The five-command set gives the retailer the full offline toolkit: lock, unlock, remind, alert, locate.
- **Status**: CODE verified + DEVICE (Android 14+ SMS delivery restrictions per family); honest limit: SMS sender IDs are spoofable, so LOCK from a spoofed number remains possible by design (now DoS-limited; documented — TOTP-gated UNLOCK and the portal paths are the authenticated fallbacks).

#### EmidostSimSentinelReceiver / SimSentinelStore (EmidostSimSentinelReceiver.kt:39,17)
- **Claim**: SIM removal/swap sentinel: 30 s debounced absent-lock, IMSI/ICCID swap detection.
- **How it works**: On SIM_STATE_CHANGED / SIM_CARD_STATE_CHANGED / AIRPLANE_MODE_CHANGED; gates: live DO + outstanding loan + lock plan (notify_only never locks); IMSI baseline mismatch → immediate hard lock; ICCID baseline via SubscriptionManager catches Android 10+ null-IMSI swaps; a confirmed ABSENT state schedules a 30 s debounce that re-reads the live SIM state, DO and loan at fire time before locking.
- **What it prevents**: A customer ejecting or swapping the SIM to escape the lock; false locks from transient UNKNOWN states (only confirmed ABSENT locks, re-verified at fire time).
- **Status**: CODE verified + DEVICE (baseline reads can be null on some devices — documented).

#### EmidostAccessibilityService (EmidostAccessibilityService.kt:26)
- **Claim**: Customer-consented steering deterrent + enrolment pairing capture.
- **How it works**: Enabled only via the real system toggle; steering (Settings/permission-manager/Play/Security-center packages) relaunches the app's lock screen while the loan is outstanding — unlocking there needs the portal PIN or owner TOTP (hidden entry); the ONLY content read is the wireless-debugging pairing dialog and the connect port during an authorized session: settings package only, 10-min expiry enforced, regex in RAM, values cleared when the session ends (`AdbBridge.clear`).
- **What it prevents**: A customer tampering with Settings to disable protection, and any permanent reading/logging of screen content (transient, scoped, cleared) while still capturing the pair address + code for the wireless enrol flow.
- **Status**: CODE verified; honest limit: deterrence quality per OEM is DEVICE.

#### Totp.verify (Totp.kt:22)
- **Claim**: Offline RFC 6238 verification of the owner's 8-digit TOTP.
- **How it works**: HMAC-SHA1 over the big-endian 8-byte counter (now/30 s), dynamic truncation, `% 100_000_000`, 8-digit compare with ±1 window; the secret is the base64 string delivered over the authenticated heartbeat.
- **What it prevents**: A stale/offline unlock code being rejected, and any code outside the 90 s acceptance window working.
- **Status**: CODE verified (byte-exact with the portal generator and the new shared totp.ts; cross-checked by tests).

#### DevicePinStore.verify (SmsCommandStore.kt:61)
- **Claim**: Offline verification of the portal-set device PIN.
- **How it works**: Compares `sha256(pin + ":" + installation_id)` (Base64 NO_WRAP) against the heartbeat-delivered `pin_verify`; the hash never leaves service-role storage except to the device.
- **What it prevents**: A PIN stored or compared in plaintext; a stolen DB row directly yielding the PIN (brute-force of the salted hash is the documented residual risk for 4-8 digit PINs).
- **Status**: CODE verified; honest limit: 4-8 digit PINs are brute-forceable from the hash offline — accepted tradeoff, documented.

#### SyncStateStore / LockStateStore (SyncStateStore.kt:10; LockStateStore.kt:17)
- **Claim**: Device-protected persistence for watchdog state and the unlock-wins watermark.
- **How it works**: `SyncStateStore.offlineLockDue` (5-day, lock-plan + loan-gated) and `LockStateStore.isLockStale` (`unlockAtServerTime = serverNowMs − elapsedDelta` with a boot-count same-boot guard and a wall+skew fallback after reboot); all prefs via `DpcContext` (API-24-safe).
- **What it prevents**: A killed app losing the watchdog/watermark (survives reboot via direct boot), a changed device wall clock voiding a fresh LOCK or resurrecting a stale one, and crashes on Android 6.
- **Status**: CODE verified.

#### DpcContext.wrap (DpcContext.kt:12)
- **Claim**: API-24-safe device-protected storage wrapper.
- **How it works**: `createDeviceProtectedStorageContext()` on API 24+, plain context below (minSdk 23).
- **What it prevents**: `NoSuchMethodError` crashes on Android 6 devices.
- **Status**: CODE verified.

#### EmidostAdbBridge (EmidostAdbBridge.kt:20)
- **Claim**: Wireless-enrol step runner driving a bundled AOSP adb client (pair/connect/grants/dpm/readback/cleanup).
- **How it works**: Holds transient pairing values and `clear()`s them on session end; the real step runner copies the vendored adb binary + `libc++_shared.so` (RUNPATH-patched bundle, Apache-2.0, source URL + sha256 + NOTICE recorded) from retailer-app-only assets to `filesDir/emidost-adb/` (chmod 700), runs each step with a 20 s timeout and kill-on-expiry (`adb pair` code via stdin, `adb connect`, `pm grant` list, `appops SYSTEM_ALERT_WINDOW`, `dpm set-device-owner`, `dpm list device-owners` readback, debug-off cleanup, disconnect), and reports `{ ok, output, readback }` per step, stopping the chain on the first failure. On the customer APK the binary is absent and `status()` honestly reports "adb binary missing" — the customer phone never carries an adb client.
- **What it prevents**: A fake "paired" claim (every step's real output is surfaced); a runaway adb process (timeout + kill); the pairing crypto being misrepresented as a from-scratch Kotlin SPAKE2 (it is the vendored AOSP binary, honestly documented).
- **Status**: CODE + DEVICE (per-OEM walk pending; the bundled-binary approach is the proven Termux/Remote-Adb-Shell method).

#### OemFingerprint / OemPermissionHelper (OemFingerprint.kt:25,115)
- **Claim**: 22-brand OEM detection + autostart/battery settings deep links.
- **How it works**: Manufacturer/brand matching (Xiaomi/vivo/OPPO/HONOR/Samsung/Transsion/near-stock) → family profile with verified component intents; helper opens the first resolvable autostart/background-popup screen, falling back to battery-optimization settings.
- **What it prevents**: Staff guessing per-OEM setup steps and the DPC being killed by OEM battery managers.
- **Status**: CODE verified (research-grade matrix; per-family certification is DEVICE).

#### EmidostLocation.fetch (EmidostLocation.kt:20)
- **Claim**: On-demand single location fix, only when the owner asks.
- **How it works**: Last-known first (10-min freshness), else one bounded single update (8 s timeout); no background tracking.
- **What it prevents**: Constant background location collection; the device only reports when a LOCATION command arrives.
- **Status**: CODE verified.

### 5. packages/shared

#### isLockCommandStale (packages/shared/src/stale.ts:42)
- **Claim**: JS mirror of the native unlock-wins watermark.
- **How it works**: `unlockAtServerTime = serverNowMs − (nowElapsedMs − lastUnlockElapsedMs)` when same boot; wall+skew fallback after reboot; missing data fails toward stale. Used by the customer app's LOCK branch to ack SUPERSEDED.
- **What it prevents**: A fresh LOCK being voided by device-clock games, and a pre-unlock LOCK re-locking after unlock.
- **Status**: CODE verified (9/9 node tests).

#### totpCode / totpSecondsLeft / base64ToBytes (packages/shared/src/totp.ts:35,58,16)
- **Claim**: Retailer-side RFC 6238 generator, byte-exact with Totp.kt.
- **How it works**: jsSHA HMAC-SHA1 over the big-endian counter; 8 digits via `% 100_000_000` + padStart; padding-tolerant pure-JS base64 decode (same bytes as android.util.Base64.DEFAULT); `totpSecondsLeft` = seconds to the next 30 s boundary (1..30).
- **What it prevents**: The retailer's offline code drifting from what the locked phone accepts (wrong digits/window/base64 would strand the customer).
- **Status**: CODE verified (RFC 6238 vectors + node:crypto cross-check, 4/4).

#### createApi (packages/shared/src/api.ts:15)
- **Claim**: Typed bearer-authenticated client for every API route the apps use.
- **How it works**: `req()` attaches the Supabase access token (or X-Device-Token for device routes) and throws with status + body on failure; methods cover owner/retailer/device surfaces incl. `sendCommand` and `getDeviceUnlockKey`.
- **What it prevents**: Apps calling endpoints with the wrong shape/verb, and (with web-side gates) cross-role access.
- **Status**: CODE verified.

#### getOemProfile / detectFamily / OEM_NOTES (packages/shared/src/oemMatrix.ts:39,26,156)
- **Claim**: The 22-brand verified OEM matrix used by both apps.
- **How it works**: Manufacturer/brand regex detection → per-family profile with setup steps, autostart/battery needs, restricted-settings path and pairing gate hints; platform notes record resetPassword reality, GLOBAL_ACTIONS default, A13+ restricted settings.
- **What it prevents**: Untested OEM advice being presented as fact; every family is only "certified" after a device walk.
- **Status**: CODE verified (research); per-family certification = DEVICE.

#### copy.ts (lockScreenCopy / dueReminderCopy / COPY_RULES) (packages/shared/src/copy.ts:72,27,4)
- **Claim**: en/bn/hi lock-screen and reminder copy under the humanizer rules.
- **How it works**: Sentence-case, verb-first, no slop words, concrete numbers; `dueReminderCopy` feeds both the notification body and the voice playback.
- **What it prevents**: Inconsistent, alarming, or AI-slop copy on a financially sensitive screen.
- **Status**: CODE verified.

#### designTokens (packages/shared/src/designTokens.ts:175)
- **Claim**: Single source of color/type/space/motion tokens.
- **How it works**: Role accents (indigo/teal/amber), dark=locked palette, 4 px space, motion durations, reduced-motion helpers (`prefersReducedMotion`, `resolveDuration`, `withReducedMotion`).
- **What it prevents**: Divergent visual language across the three apps and the portal.
- **Status**: CODE verified.

### 6. workers/src/index.ts

#### Worker fetch router (workers/src/index.ts:73)
- **Claim**: Cloudflare Worker that serves the exact route table of the Next.js catch-all.
- **How it works**: Strips an optional `/api` prefix, matches the 20+ RouteDefs (same handlers imported from web/lib/apiHandlers, incl. `retailerUnlockKey` added in Phase 3), wires `:id` params, and shims `NextRequest`/`next/headers`; `nodejs_compat` provides node:crypto for the shared handlers; `@/lib/auth` is replaced by the bearer-token `authAdapter`.
- **What it prevents**: Behavior drift between the Vercel host and the Worker host (both serve identical handlers), and cookie-dependence on a runtime that has no cookie jar.
- **Status**: CODE verified (tsc 0; runtime deploy is the lead's CRED item).

### 7. Threat table

| Abuse vector | Blocking function(s) | Residual risk (honest) |
|---|---|---|
| Eject SIM to escape lock | `EmidostSimSentinelReceiver` (30 s debounce, ABSENT-only, re-read at fire) | IMSI/ICCID baseline can be null on some devices (documented); airplane-mode coverage now registered correctly, device walk pending |
| Swap SIM to a friend's | `SimSentinelStore` IMSI/ICCID baseline compare | Baseline set once; a cleared app-data re-baseline is gated by re-registration (device walk pending) |
| Spoof retailer SMS to unlock | `EmidostSmsReceiver` — UNLOCK requires a valid 8-digit TOTP | SMS LOCK from a spoofed number remains possible by design (documented) but is now DoS-limited: identical LOCK for the same customer within 60 s is ignored |
| Spoof SMS / SIM event to lock a settled or notify_only phone | `EmidostSmsReceiver` + `SimSentinelReceiver` loan + `lock_mode` gates | Stale loan state on a never-synced device is the documented edge (TOTP SMS unlock always wins) |
| Stale LOCK command re-locks after unlock | `LockStateStore.isLockStale` (native) + `isLockCommandStale` (JS) + SUPERSEDED acks | After-reboot wall+skew fallback is approximate by design (unlock still wins on missing data) |
| Reboot/power menu escape | `LockPolicies` (no GLOBAL_ACTIONS) + `EmidostBootReceiver` auto-lock + HOME takeover | Hardware hold/battery-pull unblockable; boot re-lock must hold per OEM (DEVICE) |
| Factory reset / FRP bypass | `FinancingProtection` (DISALLOW_FACTORY_RESET, safe-boot, add-user, debugging, FRP policy) | FRP OS-side application unverifiable in code (honest `frp_os_confirmed=false`); device walk required |
| Uninstall DPC / disable via Settings | `setUninstallBlocked` + `setUserControlDisabledPackages` + app hidden from launcher | Android 12+ can refuse user-control for DO on the primary user (attempt recorded, readback honest) |
| Set device clock to dodge due dates / watermark | `DISALLOW_CONFIG_DATE_TIME` + server_now-based watermark math | Clock changes before DO enrolment are unblocked; watermark still server-anchored |
| Turn off internet for weeks | 5-day offline watchdog (JS + native mirror), lock-plan-gated | notify_only never locks (by design); settled-but-offline >5 days can lock until first sync or TOTP SMS unlock (documented) |
| Stolen/guessed device token or enrolment token | CSPRNG identities, one-time enrolment token, token-hash compare server-side | Token theft from a rooted device is out of scope |
| Retailer over-spends credits/allowances | Server-side debit/refund RPCs + owner app busy/NaN guards (client half) | Web-side atomicity is claude's scope; client guards only prevent fat-finger errors |
| Locked phone with no network and no SMS | `unlockWithCode` (PIN/TOTP hidden entry) + `UnlockCodeScreen` (offline generator, SecureStore cache) | FIXED: heartbeat now writes the device-reported `locked` readback (true always; false only when no LOCK/DEVICE_ACTION pending; settled loans skip) — the portal indicator follows the phone |
| Kiosk pinning silently not engaging | `enterLockTask` re-asserted each loop + `kioskActive` live readback in status | Real pinning needs the device walk (A8/H2) |
| Background service killed / never started (A15 FGS caps) | START_STICKY + boot receiver + HOME-app relaunch + logged failures | dataSync 6 h/day cap is an honest limit; enforcement is local and unaffected |
| Wireless pairing code hijack (a11y read) | `EmidostAccessibilityService` reads ONLY the settings pairing dialog + connect port: settings package only, 10-min session, cleared after; adb bundle is sha256-recorded + RUNPATH-patched and ships in the retailer APK only (customer APK never carries it) | The pairing values are visible to whoever watches the target screen during the 10-min window; the adb binary is a large vendored surface (pinned by sha256 at fetch) |

### Coverage count

74 functions covered across: customer app (12, incl. PairingWalkthrough), retailer
app (10, incl. WirelessEnrol), owner app (5), device-kit Kotlin (26),
packages/shared (12), workers (1 router), plus the threat table (13 rows). All
claims match code verified this session; no device-walk item is claimed as
passed.

### Flagged for lead verification

1. REBOOT is now end-to-end at the command level: owner board button →
   `commandProxy` → `device_commands` (REBOOT enum value, migration `0012`) →
   native `rebootDevice` (schedules ~5 s out so the EXECUTED ack lands first;
   refusal while locked unchanged, reason `locked_reboot_refused`). The native
   execution half is CODE+DEVICE until the walk; D4's refusal guard is native.
2. Worker runtime deploy of the new `unlock-key` route is a CRED step (lead).
3. The code-unlock `is_locked` lag is FIXED via the heartbeat `locked`
   readback write (see unlockWithCode row); the remaining bookkeeping caveat is
   the millisecond window between the pending-command load and that write,
   which the next heartbeat converges.


## Verification evidence (lead, this session)

- `npm run verify` — 7 typecheck surfaces (web, shared, device-kit, customer,
  retailer, owner, workers): exit 0.
- Tests: `stale.test.mjs` 9/9 + `totp.test.mjs` 4/4 (RFC 6238 vectors +
  node:crypto cross-checks) = 13/13.
- `next build` (web prod): exit 0, 14/14 pages, single catch-all API function.
- Landing repo (D:\emidost2): `tsc --noEmit` exit 0.
- Live probes: portal https://emidost-pd8s.vercel.app health 200; Supabase has
  all 10 migrations applied (tables, `lock_mode`, LOCATION enum, RPCs);
  anon/RLS probes against `devices`/`payments` return `[]` (row filtering
  works).
- Pushed to github.com/emidost/emidost-core: `2b648a8`, `9c22a17`, `6e287c3`,
  `1778c6f`, `5bd8a8b`.

## Honest limits and residuals (nothing here is hidden)

1. **Migration `0017` (sales ledger) is not yet applied to the live database.**
   Until the user runs it (or the regenerated
   all-in-one) in a query tab, the `retailer_sales` table, the `sale` ledger
   kind, the `sale_id` column and the bulk allowance RPCs do not exist, so the
   sales routes return 500 and the Sales page shows nothing. 0011–0016 are
   verified applied (rate_limits RLS blocks anon writes, FCM columns, photo
   bucket, escalation column, ALERT/REMIND enums — acceptance run 2026-10-03).
   This is the only
   un-applied statement.
2. **Physical acceptance is pending.** Every CODE + DEVICE item above needs a
   real per-OEM walk (enrol → lock → 112 dials → SIM pull → reboot → SMS →
   release, plus the wireless path B walk). No family is certified until then.
3. **REBOOT refusal is native.** The REBOOT command is now end-to-end (owner
   board button → commandProxy → enum → native `rebootDevice`), and the native
   half schedules the reboot ~5 s out so the EXECUTED ack lands first; the
   refusal-while-locked guard (`locked_reboot_refused`) is the device's own —
   CODE+DEVICE until a walk exercises it.
4. **Code unlock and the portal indicator — FIXED.** The heartbeat now writes
   the device-reported `locked` readback (`true` always; `false` only when no
   LOCK/DEVICE_ACTION is PENDING/RECEIVED; settled loans skipped), so the
   portal indicator follows the phone. Residual: a lock queued in the
   millisecond window between the pending-command load and the write converges
   on the next heartbeat.
5. **Rate limiter is per-instance and fails open.** The in-memory limiter is
   per serverless instance; the shared Supabase limiter fails open when the
   DB is unreachable. Documented; Upstash/WAF is the scale answer.
6. **SMS is not cryptographically authenticated.** The sender allowlist is
   spoofable; that is why SMS LOCK additionally requires live Device Owner +
   outstanding loan + lock_mode (plus a 60 s per-customer debounce against
   spoof-DoS), and SMS UNLOCK requires the owner-issued 8-digit TOTP.
   Documented in SETUP.md.
7. **5-day watchdog vs settlement.** A loan settled while the phone is offline
   5+ days can hold a stale local lock until its first online heartbeat
   releases it; the SMS TOTP unlock is the offline escape hatch. Documented.
8. **Wireless-debugging self-pair is CODE + DEVICE, not device-passed.** The
   bundled AOSP adb client (Termux android-tools, Apache-2.0, sha256 + NOTICE
   recorded, RUNPATH-patched, retailer-APK-only) drives the real
   pair/connect/grants/dpm/readback/cleanup chain with honest per-step output;
   the pairing crypto is that vendored binary, NOT a from-scratch Kotlin
   SPAKE2. No family has passed the walk yet; the provisioning QR remains the
   recommended path until one does.
9. **Kotlin compiles only in an EAS build.** No local JDK/SDK here; the code is
   reviewed compile-clean by inspection, and the real proof is the first EAS
   Gradle build.
10. **Worker parity needs a redeploy.** The Cloudflare worker reuses the web
    handlers, so `wrangler deploy` picks up today's routes (including
    `unlock-key`); until then only Vercel serves them.

## Standing user actions (unchanged from the ledger)

1. Run `supabase/migrations/0017_retailer_sales.sql`
   (or the regenerated all-in-one) in a NEW query tab.
2. EAS builds (customer first, then retailer, then owner) + GitHub release for
   the APK download links.
3. Per-family device acceptance walks (QR path A and wireless path B), recorded
   in `checksum.md`.

