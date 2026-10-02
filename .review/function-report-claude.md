# emidost function report — claude half (web portal + API + SQL)

Draft for the lead's merged docs/FUNCTION_REPORT.md. Scope: `web/` portal pages,
`web/lib/apiHandlers/*` + `web/lib/*`, the catch-all API router,
`supabase/migrations/*`, `scripts/create_accounts.mjs`. Every claim below was
verified against the code during this session's audit and implementation
(tsc 0, `next build` exit 0, tests 9/9). Device-native halves are marked
CODE+DEVICE and are codex's scope.

---

# 1. Owner portal pages

### Login page
- **Claim**: Signs the owner or retailer staff into the portal with email + password.
- **How it works**: `web/app/login/page.tsx:14-22` calls `browserClient().auth.signInWithPassword`, then navigates to `/`; `web/app/page.tsx:6-14` reads the session and live `profiles` row and redirects by role (owner → /dashboard, staff → /console) and redirects suspended users back to login.
- **What it prevents**: unauthenticated access to the portal; suspended accounts reaching any page (the redirect re-checks `profiles.is_suspended` live on every load).
- **Status**: CODE verified.

### Dashboard
- **Claim**: Shows the owner live portfolio counts (retailers, financed phones, locked now, overdue instalments).
- **How it works**: server component queries via the cookie-bound server client with `count: 'exact', head: true` (`web/app/(portal)/dashboard/page.tsx:18-31`); "overdue" is computed honestly as unpaid schedules with `due_date < today`, where today is computed in Asia/Calcutta (`dashboard/page.tsx:12-17`), because nothing writes an OVERDUE status.
- **What it prevents**: stale/cached numbers misleading the owner (page is `force-dynamic`, layout blocks suspended users); a UTC-vs-IST off-by-one making a due-day-5 customer show overdue a day early.
- **Status**: CODE verified. Residual: counts rely on RLS (owner JWT claim) — an owner created outside `create_accounts.mjs` with no `app_metadata.role` sees zeros (documented in checksum).

### Retailers list
- **Claim**: Lists every retailer with balances, allowances and suspension state.
- **How it works**: client page reads `retailers` directly with the owner JWT (`web/app/(portal)/retailers/page.tsx:18-22`), gated by the `retailers_owner` RLS policy (0005); create/suspend actions go through the API routes below.
- **What it prevents**: a staff member or anon reading other retailers (RLS returns only what the owner policy allows).
- **Status**: CODE verified.

### Retailer create (ownerRetailers POST)
- **Claim**: Creates a retailer login, retailer row, staff profile and JWT claims in one compensating transaction.
- **How it works**: `web/lib/apiHandlers/ownerRetailers.ts:34-38` creates the auth user via the service client (`email_confirm: true`, password ≥ 8 enforced at `:27-29`), then inserts the retailer (`:41-43`), upserts the staff profile (`:51-54`), and writes `app_metadata = { role:'retailer_staff', retailer_id, provider:'email', providers:['email'] }` via `updateUserById` (`:64-69`). Every later failure rolls back the retailer row and deletes the auth user (`:55-58, 70-74`).
- **What it prevents**: half-created accounts (orphan auth users or retailer rows without logins); retailers whose JWT lacks the RLS claims, which would make their console silently empty (0005 reads `app_metadata`); accidental loss of GoTrue's `provider/providers` account-linking keys.
- **Status**: CODE verified. Residual: the rollback deletes are best-effort (`.catch(() => {})`) — a failed cleanup leaves a row the owner can see and retry.

### Retailer detail + suspend (ownerRetailer PATCH)
- **Claim**: Renames a retailer, edits its SMS phone, or suspends/resumes it.
- **How it works**: `web/lib/apiHandlers/ownerRetailer.ts:18-23` accepts only known fields; when `is_suspended` is present it also fans the flag out to every staff profile (`:28-32`) so all route-level checks see it immediately.
- **What it prevents**: a suspension that only marks the `retailers` row while a staff member keeps issuing commands — every handler (and `requireActor`) re-reads the live profile row per request, so the suspension bites the next call.
- **Status**: CODE verified.

### Credits (ownerCredits POST)
- **Claim**: Adds or removes a retailer's device-credit balance with an atomic, non-negative adjustment.
- **How it works**: after a 404 existence check (`web/lib/apiHandlers/ownerCredits.ts:18-21`), it calls the SQL `adjust_credits(rid, delta)` RPC, which does `update ... set credits_balance = credits_balance + d where id = rid and credits_balance + d >= 0 returning credits_balance` (`supabase/migrations/0003_hardening.sql:21-26`) — the constraint is enforced inside the UPDATE, not by a read-then-write. A NULL result with a negative delta maps to 400 (`:24-27`); a successful change appends a `credit_ledger` row (`:30-32`).
- **What it prevents**: the classic read-modify-write race letting two owner requests push a balance below zero; credits changing without a ledger/audit trail.
- **Status**: CODE verified.

### Allowances (ownerAllowances POST)
- **Claim**: Sets a retailer's lock-allowance total (top-up or drain).
- **How it works**: validates non-negative integer (`web/lib/apiHandlers/ownerAllowances.ts:13-14`), updates the row and audits `ALLOWANCES_SET` (`:17-22`).
- **What it prevents**: negative allowance values via the API; silent changes without audit.
- **Status**: CODE verified. Residual: it SETS the total (not a delta), so the owner UI must show the current value first — that is what the edit page does.

### Audit feed (ownerAudit GET)
- **Claim**: Returns the newest 500 audit-log rows for the owner.
- **How it works**: owner-only route, `audit_log` ordered newest-first, `Cache-Control: private, no-store` (`web/lib/apiHandlers/ownerAudit.ts:7-15`). Every mutating route in this report writes an `audit_log` row.
- **What it prevents**: undetectable admin actions — credits, allowances, suspensions, commands, payments, TOTP/PIN issues and device registrations all land in this feed.
- **Status**: CODE verified.

### Owner devices page
- **Claim**: Owner device board with LOCK/UNLOCK via the owner command proxy.
- **How it works**: `web/app/(portal)/devices/page.tsx:17-21` reads devices with an explicit column list that excludes `pin_verify`, `device_token_hash`, `device_pin_hash`, `imsi_baseline`, `iccid_baseline`; commands POST to the owner `commandProxy` route (`:23-30`).
- **What it prevents**: sensitive device material (offline-brute-forceable PIN hash, device auth token hash, SIM baselines) sitting in the browser payload.
- **Status**: CODE verified.

### Enrolment QR page
- **Claim**: Generates the DPC provisioning QR that turns a factory-fresh phone into a Device Owner.
- **How it works**: `web/app/(portal)/qr/page.tsx:29-42` builds the provisioning bundle: DPC component name, `PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM` (SHA-256 of the signing cert, converted to unpadded base64url by `hexToChecksum`, `:10-18`), the APK download URL, `LEAVE_ALL_SYSTEM_APPS_ENABLED` and `SKIP_ENCRYPTION=false`; renders via the `qrcode` package (`:44-48`).
- **What it prevents**: a phone being enrolled against a tampered or wrong APK — Android verifies the downloaded package against the embedded signature checksum before granting Device Owner.
- **Status**: CODE verified (the OS-side wizard completion is DEVICE). Residual: the checksum is pasted by the owner from EAS credentials; a mistyped value is caught by the 64-hex validation.

### TOTP issue (ownerTotp POST)
- **Claim**: Owner mints an 8-digit offline unlock code for a device.
- **How it works**: `web/lib/apiHandlers/ownerTotp.ts:24-34` reuses the existing secret unless `?rotate=1` (which mints a fresh 20-byte secret); computes RFC 6238 HMAC-SHA1/8-digit/30 s (`:39-45`), upserts the AES-256-GCM-encrypted secret + counter (`:47-51`) and audits `TOTP_ISSUED`.
- **What it prevents**: rotation invalidating codes on a phone that only has the old secret (stable by default); plaintext secrets in the DB (encrypted via `totpCrypto`).
- **Status**: CODE verified + DEVICE (the phone's offline verify is Totp.kt). Residual: a rotated secret only reaches the phone on its next online heartbeat — the comment instructs the owner to rotate while online.

### PIN set (ownerPin POST)
- **Claim**: Owner sets the 4-8 digit device management PIN without ever storing the plaintext.
- **How it works**: validates `^\d{4,8}$` (`web/lib/apiHandlers/ownerPin.ts:19-20`), stores `pin_verify = sha256(pin + ":" + installation_id)` base64 (`:27-29`), audits `DEVICE_PIN_SET`. The phone verifies the same construction offline.
- **What it prevents**: plaintext PIN storage and logging; a PIN hash that is useless without the installation_id.
- **Status**: CODE verified + DEVICE (device-side verify). Honest limit documented in code: a 4-8 digit PIN is brute-forceable from the hash, so it must never leave the service role except to the device itself.

---

# 2. Retailer console pages

### Console dashboard
- **Claim**: Shows the retailer's own counts (customers, devices, locked) and balances.
- **How it works**: reads the staff profile (`profiles_self` policy) to get `retailer_id`, then reads `retailers`, `customers`, `devices` directly with the staff JWT (`web/app/(portal)/console/page.tsx:14-29`), all scoped by the 0005 staff policies.
- **What it prevents**: cross-retailer data leakage in the UI (RLS + the explicit `eq('retailer_id', rid)` filters are belt and braces).
- **Status**: CODE verified.

### Customers list page (new)
- **Claim**: Lists the retailer's customers with EMI plan, lock plan and loan status; entry point to payments.
- **How it works**: fetches `/api/retailer/customers` (API route, tenant-checked) and renders a table linking each row to the customer detail page (`web/app/(portal)/console/customers/page.tsx:12-19`).
- **What it prevents**: the payments UI being orphaned/unreachable (it previously had no nav entry); staff reading customers outside their retailer (server route checks `retailer_id`).
- **Status**: CODE verified.

### Customer detail (record payment + schedule + history)
- **Claim**: Records a cash payment and shows the repayment schedule and payment history.
- **How it works**: loads customer, payments and schedules from the API in parallel (`web/app/(portal)/console/customers/[id]/page.tsx:19-28`); "Record" POSTs to `/api/retailer/customers/:id/payments` and reloads (`:32-42`).
- **What it prevents**: double submits and stale display (reloads after success); overpayments (the API maps the RPC's `overpayment` to 400 and shows the message).
- **Status**: CODE verified.

### New customer (lock_mode choice, IST due dates)
- **Claim**: Registers a financed customer with the full EMI plan and a "lock vs notify-only" choice.
- **How it works**: form posts to `/api/retailer/customers` (`web/app/(portal)/console/customers/new/page.tsx:21-36`); the radio choice sends `lock_mode: 'lock' | 'notify_only'` (`:63-71`). Server-side generates the schedule with IST due days (see retailerCustomers POST).
- **What it prevents**: a notify-only customer ever getting locked (the plan chip is stored server-side and delivered to the phone each heartbeat); missing-field submits (required inputs + server validation).
- **Status**: CODE verified.

### Console devices page
- **Claim**: Retailer device list with LOCK/UNLOCK (allowance-checked server-side).
- **How it works**: reads devices with the explicit non-sensitive column list (`web/app/(portal)/console/devices/page.tsx:17-23`) and posts commands to `/api/retailer/devices/:id/commands` (`:27-36`).
- **What it prevents**: `pin_verify`/`device_token_hash`/SIM baselines reaching a retailer's browser (a staff member could otherwise brute-force the device PIN offline); commands without allowance debit or on settled loans (server route).
- **Status**: CODE verified.

---

# 3. Device API routes

### register
- **Claim**: Binds the customer app's installation to an enrolment session with a one-shot token.
- **How it works**: rate-limited 20/min (`web/lib/apiHandlers/register.ts:14-16`); looks up the session by sha256(token) (`:28-33`), rejects expired, suspended-retailer and settled-loan sessions (`:33-40`); the takeover guard (`:47-59`) refuses to re-point an installation_id that belongs to another retailer or to another *active* customer — a device whose loan is COMPLETE/SETTLED may be re-enrolled (resale). The token is spent with a state CAS `created → installed` (`:62-66`), then the device row is upserted with `device_token_hash = sha256(deviceToken)` (`:68-79`).
- **What it prevents**: token replay (CAS + unique `token_hash` index); a stolen token re-pointing (stealing) a live phone's command channel; settled phones being silently re-enrolled onto the same loan; unbounded registration attempts (rate limit).
- **Status**: CODE verified. Residual: the token is 64-bit hex (typed by hand) — acceptable because it is one-shot, expires in 15 min and the route is rate limited.

### heartbeat
- **Claim**: The phone's only polling channel — delivers commands, TOTP secret, PIN verify hash, loan/lock state and server time.
- **How it works**: authenticates by `installation_id` + `x-device-token` hash match (`web/lib/apiHandlers/heartbeat.ts:19-33`); device-reported `mode` can only promote to `device_owner` when an open enrolment session exists (`:43-49`), and activation now covers ALL open states including `created` (`:53-57`) with a one-time credit consumption (`:59-69`); a 24 h lazy sweeper expires stuck PENDING/RECEIVED commands and refunds LOCK allowances once (`:77-96`); one parallel wave updates `last_heartbeat_at` and fetches pending commands, TOTP secret and next due (`:100-111`); a suspended retailer's commands are filtered down to UNLOCK/RELEASE (`:115-117`); the response carries `lock_mode`, EMI terms, `pin_verify`, decrypted TOTP secret, `is_locked`, `overdue_days` (IST parse, `:132-134`) and `server_now`, with an honest empty `policies` map (`:136-158`).
- **What it prevents**: a client self-promoting its own device to owner status (open-session gate); credits leaking on re-activation (state CAS); a dead device holding a retailer's allowance forever (sweeper + refund); an IST due-day-5 customer being flagged overdue on UTC time; the server ever faking "all policies applied" (the phone reports real OS readback).
- **Status**: CODE verified + DEVICE (the phone's enforcement of the delivered commands is native). Honest limit: `policies` is intentionally empty; FRP/PIN/TOTP values are delivered but their OS application is device-reported.

### ack
- **Claim**: Records a command's terminal outcome with atomic, immutable transitions.
- **How it works**: device-authenticated (token hash, `web/lib/apiHandlers/ack.ts:28-34`); only EXECUTED/SUPERSEDED/FAILED/EXPIRED acks accepted (`:24-25`); a settled loan's LOCK-EXECUTED ack is forced to SUPERSEDED with allowance refund and an ack row (`:46-59`); all other transitions go through a CAS on PENDING/RECEIVED (`:66-69`) so terminal states can't be resurrected; non-EXECUTED LOCKs refund the allowance (`:73-75`); EXECUTED flips `is_locked` for LOCK/UNLOCK, and RELEASE unhides the device + writes a release event + frees the device credit once (`:77-91`); LOCATION payloads are stored only on EXECUTED (`:98-103`).
- **What it prevents**: a late or duplicate ack re-opening a cancelled/expired command (terminal immutability); a paid-off phone re-locking (settled gate); allowances being burned by locks that never executed (refund); credit refunds firing twice (SQL guard in `release_device_credit`); fake EXECUTED states from a non-Device-Owner phone (the native side acks FAILED).
- **Status**: CODE verified + DEVICE (native enforcement result). Residual: `is_locked` is server-side bookkeeping — the real lock state is the phone's own readback.

### commands (retailer LOCK/UNLOCK/LOCATION)
- **Claim**: Queues a retailer command; LOCK consumes one lock allowance atomically.
- **How it works**: staff + suspension + tenant checks (`web/lib/apiHandlers/commands.ts:14-30`); LOCK on a settled loan refused (`:33-36`); the command is INSERTED FIRST and the `decrement_allowance` RPC runs second — on zero balance the command is rolled back to CANCELLED (`:38-51`); every issue is audited (`:58-61`).
- **What it prevents**: a retailer over-spending lock allowances (atomic decrement, command cancelled on refusal); paid loans being locked; an allowance being debited for a command that never got queued (debit-after-insert order).
- **Status**: CODE verified. Residual: if the ledger insert after a successful debit fails, the debit is not rolled back — rare and auditable, noted for a future wave.

### commandProxy (owner commands)
- **Claim**: Owner-issued LOCK/UNLOCK/LOCATION/RELEASE with no allowance consumption.
- **How it works**: owner-only (`web/lib/apiHandlers/commandProxy.ts:9-11`); LOCK on settled loans refused (`:24-26`); queues with `created_by` and audits with `by: 'owner'` (`:27-36`).
- **What it prevents**: a retailer-grade allowance economy applying to the owner (owner locks are free by design); settled-loan locks from the owner board.
- **Status**: CODE verified.

---

# 4. Retailer API routes + shared lib

### requireActor (auth gate)
- **Claim**: Verifies the caller's session (portal cookie or app Bearer token) and returns the LIVE profile row.
- **How it works**: `web/lib/auth.ts:11-46` — Bearer tokens are verified with `auth.getUser(token)` against the anon client (apps/worker parity), cookies via the SSR client; either way the role/retailer_id/is_suspended come from a fresh `profiles` SELECT, never from JWT claims.
- **What it prevents**: trusting a stale JWT after suspension/role changes (claims are frozen at login for up to an hour); one auth code path for portal + apps + worker.
- **Status**: CODE verified.

### retailerCustomers GET / POST
- **Claim**: Lists the retailer's customers (GET) and creates a customer with the full EMI schedule (POST).
- **How it works**: GET scopes by `profile.retailer_id` (owner sees all), blocked when suspended (`web/lib/apiHandlers/retailerCustomers.ts:8-21`). POST validates all 7+ fields with integer/range checks (`:31-41`), rejects duplicate IMEI per retailer (`:45-47`), generates `customer_code = 'EMD-' + 3 random bytes` (`:49`), inserts the customer with `lock_mode` (`:51-58`), then generates the repayment schedule in Asia/Calcutta (IST due days, month-end clamped, `:66-86`) and deletes the customer if the schedule insert fails (`:87-91`).
- **What it prevents**: NaN/negative EMI terms reaching the DB (explicit integer checks); the same IMEI registered twice for one retailer; due-day drift when Vercel runs UTC; half-created customers (rollback on schedule failure).
- **Status**: CODE verified. Residual: `customer_code` is 24 bits — fine as a companion factor because the retailer's phone number is the SMS sender gate and UNLOCK additionally needs a TOTP.

### consent
- **Claim**: Records an optional, counter-consent audit row for a customer.
- **How it works**: staff-only, tenant-checked, inserts `text_hash` (sha256 of the fixed consent text), lang, otp_ack and optional signature ref (`web/lib/apiHandlers/consent.ts:14-44`), audited.
- **What it prevents**: consent being claimed with no record at all when the retailer wants one; cross-retailer consent rows.
- **Status**: CODE verified. Business rule (documented): direct counter consent is the binding step; this row is optional and never a blocking precondition.

### enrollment
- **Claim**: Creates a 15-minute, one-shot enrolment session and returns the raw token exactly once.
- **How it works**: staff-only + suspension gate + tenant check (`web/lib/apiHandlers/enrollment.ts:13-21`); token = `randomBytes(8).toString('hex')` and only `sha256(token)` is stored (`:27-37`).
- **What it prevents**: token replay and theft-from-DB (hash-only storage); indefinite tokens (15-min expiry); a suspended retailer starting new enrolments.
- **Status**: CODE verified.

### enrollmentGet
- **Claim**: Lets a retailer (or owner) fetch one enrolment session's state.
- **How it works**: tenant check on `retailer_id` for staff (`web/lib/apiHandlers/enrollmentGet.ts:12-15`).
- **What it prevents**: a staff member probing another retailer's session rows (which contain customer ids and states).
- **Status**: CODE verified.

### payments GET / POST
- **Claim**: Lists a customer's payments (GET) and records one atomically with schedule settlement (POST).
- **How it works**: both tenant-checked (`web/lib/apiHandlers/payments.ts:12-14, 32-34`); POST rejects positive-check failures, settled loans (`:28-37`), and calls the SQL `record_payment` RPC (`:43-47`); an RPC `overpayment` exception maps to 400 (`:49-53`); when the loan completes, the device credit is freed via `release_device_credit` (`:59-62`); every payment is audited (`:64-67`).
- **What it prevents**: double allocation of one payment across schedules (serialized per customer inside the RPC); overpayments silently vanishing; payments on a settled loan; loan completion without a release_events row + credit refund (the RPC does both).
- **Status**: CODE verified. The phone's local release on COMPLETE is CODE+DEVICE (customer app settled branch).

### schedules
- **Claim**: Returns a customer's EMI schedule.
- **How it works**: tenant-checked, ordered by due_date (`web/lib/apiHandlers/schedules.ts:7-18`).
- **What it prevents**: staff reading another retailer's schedule (payment posture leakage).
- **Status**: CODE verified.

### retailerDevices
- **Claim**: Lists the retailer's devices with column hygiene.
- **How it works**: explicit column list excluding `pin_verify`, `device_token_hash`, SIM baselines (`web/lib/apiHandlers/retailerDevices.ts:12-16`).
- **What it prevents**: sensitive device material in API responses to retailer clients (the same leak class the console page was fixed for).
- **Status**: CODE verified.

### retailerUnlockKey
- **Claim**: Hands the retailer the phone's offline-unlock TOTP secret (Authenticator style).
- **How it works**: staff-only + suspension gate (`web/lib/apiHandlers/retailerUnlockKey.ts:20-23`); device must belong to the retailer (404 otherwise, `:26-30`); no secret row → 409 `no_unlock_key` with the "must sync once online" message — it never mints (`:32-39`); decrypts the AES-256-GCM blob (`:41-44`); returns the SAME base64 secret the heartbeat delivered to the phone plus `period: 30, digits: 8` (`:49`); audits `TOTP_KEY_ISSUED_RETAILER` (`:46-48`).
- **What it prevents**: a retailer minting codes for a phone that can never receive a fresh secret (offline phone = dead end); unauthorized staff reading unlock keys (tenant + suspension gates); silent key handout (audit row).
- **Status**: CODE verified + CODE (app generator half: codex). Residual: holding the secret lets the holder generate valid unlock codes — the route is deliberately retailer-scoped and audited for that reason.

### Rate limiting (in-memory + shared)
- **Claim**: Caps device-facing endpoints per IP + installation, with a cross-instance DB limiter behind it.
- **How it works**: `web/lib/rateLimit.ts:6-21` keeps an in-memory bucket per key (cap 10 000 entries); `sharedRateLimit` (`:37-55`) calls the SECURITY DEFINER `rate_limit_hit` RPC with the service key and FAILS OPEN on DB errors (the local limiter still ran first). register and ack use both; heartbeat uses the local one to stay on the hot path.
- **What it prevents**: token brute-forcing on register, ack spam, and heartbeat floods from a single IP/installation.
- **Status**: CODE verified. Honest limits: the in-memory limiter is per serverless instance (cold resets), and the shared limiter fails open when the DB is unreachable — both documented; the `rate_limits` table itself is closed to non-service roles by 0011.

### totpCrypto (at-rest encryption)
- **Claim**: Encrypts/decrypts TOTP secrets with AES-256-GCM.
- **How it works**: key = sha256(TOTP_ENC_KEY or service key) (`web/lib/totpCrypto.ts:9-18`), 12-byte random IV + auth tag, JSON envelope `{v, iv, tag, ct}` (`:20-30`); decryption returns the base64 secret and throws/null on tamper (`:32-49`). Production with no key throws.
- **What it prevents**: a DB dump exposing usable TOTP secrets; ciphertext tampering (GCM tag).
- **Status**: CODE verified. Residual: the heartbeat legitimately decrypts and delivers the secret to the phone over TLS.

---

# 5. SQL layer

### RLS model (0005) — JWT claims + staff SELECT-only + live suspension guard
- **Claim**: Every table's access is decided by the JWT `app_metadata` role claim, with staff limited to SELECT and suspension re-checked against the live profiles row.
- **How it works**: `supabase/migrations/0005_rls_jwt.sql` drops the recursive profile-reading helpers and recreates all policies on `auth.jwt() -> 'app_metadata' ->> 'role'/'retailer_id'`. Staff are SELECT-only on customers (`customers_read`), payments (`payments_read`), emi_schedules (`schedules_read`) and devices (`devices_access`); every staff branch adds `not exists (select 1 from profiles p where p.id = auth.uid() and p.is_suspended)` — an own-row subquery that `profiles_self` permits (no recursion). Owner branches keep full access; `totp_secrets` stays `using (false)` (service role only).
- **What it prevents**: a staff member UPDATE-ing `customers.status` to COMPLETE to settle a loan without payment, deleting payment rows to hide cash, or marking schedules PAID outside `record_payment` (the whole settlement/release machinery is now API/RPC-only); a suspended retailer keeping direct DB access on a still-valid JWT (the guard is evaluated per query, not at login); tenant leakage between retailers.
- **Status**: CODE verified (applied on live DB by the user per checksum; anon probes return `[]`).

### Credit + allowance RPCs (0003/0008/0010)
- **Claim**: Balances move only through atomic SQL functions with ledger rows.
- **How it works**: `adjust_credits` (`0003_hardening.sql:21-26`) enforces non-negativity inside the UPDATE; `decrement_allowance` (`0001`), `increment_allowance`, `consume_device_credit`, `refund_device_credit` (`0008_allowance_refund.sql`) are single-statement atomic updates; `release_device_credit` (`0010_credit_lifecycle.sql:13-36`) frees a credit only if `slot_consumed` exists and no `slot_freed` row does, with a partial unique index on `(device_id) where kind = 'slot_freed'` making a concurrent double-release fail; `ledger_kind` gained `lock_refund` so refund rows are never dropped by the enum.
- **What it prevents**: read-then-write races driving balances negative or crediting twice; activation/release cycles double-consuming or double-refunding a device credit; refunds that were previously silently discarded (the enum fix).
- **Status**: CODE verified. Residual: direct EXECUTE is available to any role, but non-service callers hit RLS (zero rows) — the service role is the only effective caller.

### rate_limits + 0011 closure
- **Claim**: A shared, cross-instance rate-limit counter that non-service roles cannot touch.
- **How it works**: `rate_limit_hit` upserts a per-key count/reset_at atomically (`0009_rate_limit.sql:11-29`); `0011_rate_limits_rls.sql:10-15` enables RLS (no policies = closed) and revokes public EXECUTE on the function, granting only `service_role`.
- **What it prevents**: anyone with the public anon key reading the key table (IP + installation pairs), deleting rows to reset their counters, or pre-inflating victims' counters for a denial of service — the table was previously wide open because Supabase grants anon table privileges and RLS was never enabled.
- **Status**: CODE verified; the 0011 DDL is the one piece the user must run in a query tab (flagged in checksum).

### record_payment RPC
- **Claim**: One transaction that records a payment and settles the oldest unpaid schedules, serialized per customer.
- **How it works**: `0010_credit_lifecycle.sql:42-96` locks the customer row (`for update`), rejects settled loans, computes total remaining due and RAISES `overpayment` when the amount exceeds it, inserts the payment, allocates oldest-first against `amount_due - amount_paid` (PARTIAL for the remainder), and when nothing unpaid remains flips the loan to COMPLETE and inserts a `release_events` row — all committed together; concurrent payments for one customer serialize on the row lock.
- **What it prevents**: one payment being counted twice against schedules; partials overwriting earlier payments; overpayments silently swallowed; a loan marked COMPLETE without a release event; a customer ending in an inconsistent state (all schedules paid but status RUNNING).
- **Status**: CODE verified.

### Indexes (0002 + extras)
- **Claim**: Hot query paths are indexed, and two unique indexes close check-then-insert races.
- **How it works**: 13 indexes in `0002_perf_indexes.sql` cover the heartbeat command scan `(device_id, status, created_at)`, next-due lookups, token lookup, duplicate-IMEI, device/audit/ledger/payment listings; `0003`/`0007`/`0010` add session, profile, release, lock_mode and rate-limit-reset indexes. `enrollment_sessions(token_hash)` and `customers(retailer_id, imei)` are UNIQUE.
- **What it prevents**: heartbeat polling degrading as command history grows; a duplicate-IMEI or double-token race slipping past the application-level checks.
- **Status**: CODE verified (applied on the live DB per the lead's probe).

### All-in-one migration (0000)
- **Claim**: One idempotent file brings a fresh (or partially migrated) DB to the current schema.
- **How it works**: `0000_all_in_one.sql` concatenates 0001-0011 in order with `if not exists`/exception guards, and the RLS section is self-healing (drops old policy names like `customers_access` before creating the new pairs; drops the actor helpers only after the new policies exist).
- **What it prevents**: a fresh project skipping a migration (e.g. 0007's `lock_mode`, 0011's RLS) and hitting runtime 500s; the old recursive actor_role policies surviving on a re-run.
- **Status**: CODE verified (idempotency reviewed; live DB already carries 0001-0010).

### Account script (create_accounts.mjs)
- **Claim**: Creates the owner/staff accounts with the app_metadata claims RLS depends on.
- **How it works**: admin API creates users with `app_metadata { role:'owner', provider, providers }` for the owner and merges `{ role:'retailer_staff', retailer_id, provider, providers }` for the staff (`scripts/create_accounts.mjs:69-103`); profiles/retailers/customer rows are inserted with the service key.
- **What it prevents**: an owner or staff login whose JWT lacks the role claim (which would silently zero out every RLS-gated read); loss of GoTrue `provider/providers` on the metadata update.
- **Status**: CODE verified (live demo accounts work per the earlier probe).

---

# Threat table (abuse vector → blocking function → residual)

| Abuse vector | Blocked by | Residual (honest) |
|---|---|---|
| Staff settles a loan without payment (direct PostgREST UPDATE of customers.status / schedules) | 0005 SELECT-only policies + `record_payment` as the only settlement path | A stolen staff JWT keeps read access until expiry; route-level suspension is live, RLS suspension guard is live per query |
| Staff deletes payment rows to hide cash | `payments_read` (staff no UPDATE/DELETE) | Owner can still mutate rows by design |
| Suspended retailer keeps working on a cached JWT | `requireActor` live profile check (every route) + `is_suspended` RLS guard (every staff branch) | None identified beyond JWT read access, which the guard also blocks |
| Attacker brute-forces the enrolment token | 20/min register rate limit + 15-min expiry + one-shot CAS | Token is 64-bit (typed by hand); acceptable under the limits |
| Stolen token re-points a live phone to the attacker's device | register takeover guard (retailer AND customer match; settled devices excepted for resale) | An attacker holding a valid unused token for the same customer is the retailer's own compromise |
| A settled (paid-off) phone re-locks | commands.ts + commandProxy settled refuse; ack.ts settled gate forces SUPERSEDED + refund | The device's 5-day offline watchdog can hold a stale local lock until its first online heartbeat (documented in checklist E1); SMS UNLOCK needs a TOTP |
| Allowance theft or leakage (locks never executed, dead devices) | decrement-at-queue + refund on FAILED/EXPIRED/SUPERSEDED + 24 h heartbeat sweeper, all one-time via CAS | If the ledger insert after a debit fails, that single debit is unrecovered (auditable) |
| Overpayment on a loan | `record_payment` raises `overpayment` → 400 | Exact-amount culture required; no store-credit concept yet |
| PIN brute-force by staff | explicit column lists on console/devices page + retailerDevices route keep `pin_verify` out of staff payloads | Owner API responses and the heartbeat intentionally carry it (owner/device are trusted) |
| Rate-limit bypass via the shared table | 0011 RLS + revoked EXECUTE on `rate_limit_hit` | The limiter itself still fails open when the DB is unreachable; in-memory limiter is per-instance |
| TOTP secret theft from a DB dump | AES-256-GCM at rest (totpCrypto) | Whoever holds the decrypted secret can generate valid unlock codes; retailer handouts are audited |
| Fake "policies applied" claims | heartbeat returns an empty `policies` map; the phone reports its own OS readback | OS-side truth requires the DEVICE acceptance walk |
| Retailer created without working RLS claims | ownerRetailers POST writes `app_metadata` (merge-safe) | An owner created outside the script (manual SQL) still needs the claim — SETUP.md now forbids that path |
| Unauthorized unlock-key handout | retailerUnlockKey: staff + suspension + tenant gates + audit | A legitimate staff member holding the secret can unlock — by design, audited |

---

Count: 39 functions covered (12 owner portal, 5 retailer console, 5 device API,
9 retailer API + shared lib, 8 SQL layer), each with claim / mechanism / prevention / status.

Items flagged for lead verification: (1) the 0011 DDL is the only un-applied
piece on the live DB (user query-tab step); (2) the app-side halves (Totp.kt
verify, retailer generator UI, worker dispatch parity for unlock-key) are
codex's rows in the merged report; (3) the report deliberately keeps all
DEVICE items as CODE+DEVICE — no overclaiming.
