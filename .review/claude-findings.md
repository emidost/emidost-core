# Claude audit — web portal, API routes, SQL migrations, docs (2026-10-03)

Scope audited: `web/` (all pages + all `lib/apiHandlers/*` + `app/api/[[...slug]]` router),
`supabase/migrations/*.sql` (0000–0010 + all-in-one), `docs/`, root + web `package.json`
scripts. Supporting evidence read: `scripts/create_accounts.mjs` (wiring), `CONTEXT.md`,
`checksum.md`, `SETUP.md`, `README.md`.

Read-only evidence collected this session:
- `npx tsc --noEmit -p web/tsconfig.json` → exit 0 (no errors).
- `npx next build` (web, prod) → exit 0, 13/13 pages generated.
- git log confirms ledger pushes (b5cb2b8, cf921b8, 4dec110, a6a6302, 7131eeb, 7de186e, 1671fb5).
- `.env.local`/`.env` are gitignored; only `.env.example` files are tracked.

---

## P0 — blocks the 100/100 gate

### CL-P0-1 — Live DB is behind the migrations; several code paths will 500 against it
- Evidence: `checksum.md:13` ("DB lacks lock_mode per live probe"), `docs/BUILD_AND_DEPLOY_STEPS.md:13-14` ("run the single 0000_all_in_one.sql ... before the first phone enrolment").
- Why it matters: against the stale live DB, `retailerCustomers.ts:57` (INSERT `lock_mode`), `commands.ts:41` (LOCATION via `command_type` enum value from 0004), `payments.ts:42` (`record_payment` RPC from 0010), and `sharedRateLimit` (`rate_limit_hit` from 0009) all fail. Every live verification of A4/E2/D9/G1 and the rate-limit claims is blocked until the SQL is applied.
- Proposed fix: run `supabase/migrations/0000_all_in_one.sql` in a NEW query tab on `fhmndtznwtchqrfuobyq` (idempotent, includes 0001–0010 in order). This is a user/lead action — I am read-only this phase. Re-probe `customers.lock_mode` + `rate_limits` afterwards and record the result in `checksum.md`.

---

## P1 — wrong behavior or real security/integrity hole

### CL-P1-1 — Retailer created from the portal gets a JWT with no app_metadata claims → their web console is dead
- Evidence: `web/lib/apiHandlers/ownerRetailers.ts:34-38` (`svc.auth.admin.createUser({ email, password, email_confirm: true })` — no `app_metadata`); RLS now reads claims, `supabase/migrations/0005_rls_jwt.sql:13-24, 36-41, 45-52`; direct client queries in `web/app/(portal)/console/page.tsx:21-26`, `console/devices/page.tsx:21`, and owner-side `dashboard/page.tsx:16-23`, `retailers/page.tsx:21`, `audit/page.tsx:17` all depend on `auth.jwt() -> 'app_metadata'`.
- Why it matters: the demo retailer works only because `scripts/create_accounts.mjs:100-103` PUTs `app_metadata.role/retailer_id`. Any retailer created through the portal UI (the normal owner flow) signs in fine but sees an empty console (RLS returns 0 rows for retailers/customers/devices) and the owner dashboard/retailers/audit pages show zeros for any owner whose account was not created by the script (e.g., SETUP.md's manual owner path).
- Proposed fix: in `ownerRetailers.ts` after `createUser`, call `svc.auth.admin.updateUserById(authUser.user.id, { app_metadata: { role: 'retailer_staff', retailer_id: retailer.id, provider: 'email', providers: ['email'] } })` (merge, not replace — see CL-P2-10). Mirror in `scripts/create_accounts.mjs` to merge rather than replace app_metadata. Add a post-creation claim assertion (re-issue session) or document "log out and back in" if the portal session predates the claim.

### CL-P1-2 — Ledger claims SECURITY DEFINER actor helpers; final SQL deletes them (claim vs code contradiction)
- Evidence: `checksum.md:43` ("actor helpers → SECURITY DEFINER (fixes recursive RLS)") and `0003_hardening.sql:6-18` vs `0005_rls_jwt.sql:114-117` (`drop function actor_role/actor_retailer`) and `0000_all_in_one.sql:585-588`. Final DB state = JWT-claim policies, no helpers. `0001_schema.sql:221-231`'s comment ("RLS resolves the role straight from public.profiles ... never via a stale JWT") is also now false.
- Why it matters: checksum.md is the verification ledger; a reviewer chasing the "hardening" claim will find the opposite design shipped. More importantly the live behavior now contradicts the documented intent: role/suspension changes only affect RLS when the JWT (≤1h) expires — e.g., a suspended retailer keeps direct PostgREST read access via their existing token (see CL-P1-3). Route-level code re-checks `profiles.is_suspended` live, so the API is safe; the RLS layer is not.
- Proposed fix: pick ONE mechanism and make all artifacts agree. Recommended: keep JWT-claim RLS (fast, no recursion) and (a) update `checksum.md` to say "actor helpers removed in 0005; RLS reads JWT app_metadata; suspension enforced at route level", (b) add an `is_suspended` guard to the staff branches of the 0005 policies (subquery on own profile row passes `profiles_self`), (c) fix the stale 0001 comment.

### CL-P1-3 — Staff write policies allow bypassing the settlement/release business logic (direct PostgREST)
- Evidence: `0005_rls_jwt.sql:35-41` (`customers_access` **for all** with check for staff of that retailer — staff can UPDATE `customers.status` to COMPLETE/SETTLED), `:56-72` (`payments_access` **for all** — staff can UPDATE/DELETE payment rows), `:66-72` (`schedules_access` **for all** — staff can mark schedules PAID directly). No policy references `is_suspended`.
- Why it matters: a rogue or careless staff member with the anon key (public, embedded in the apps) can (1) settle a loan without payment — stops locks, bypasses `record_payment`'s release_events + credit refund, (2) delete payment rows to hide cash, (3) mark schedules paid producing an inconsistent loan (all PAID but still RUNNING). The API routes are correct; the RLS layer does not protect the same invariants.
- Proposed fix: make staff read-only on `payments` and `emi_schedules` (SELECT policy only); restrict staff UPDATE on `customers` to non-status columns (or SELECT+INSERT only) — all mutations then flow through the Vercel API/RPCs which enforce the rules. Verify the retailer app writes everything through the shared API client before tightening (coordinate with codex).

### CL-P1-4 — `rate_limits` table has RLS disabled; the migration comment says it is "closed" (false)
- Evidence: `0009_rate_limit.sql:2-3` ("there are no anon policies, so the table is closed") vs `:5-9` (`create table ... rate_limits` with **no** `enable row level security`). Supabase grants `anon`/`authenticated` table privileges on public-schema tables by default; without RLS the table is wide open.
- Why it matters: anyone with the public anon key can SELECT all rate-limit keys (leaks IP + installation tuples), DELETE rows to reset their own counters (bypass the cross-instance limiter), or pre-inflate victims' counters (denial of service for legitimate devices). The comment's reasoning ("no policies = closed") is backwards — a table without RLS enabled ignores policies entirely.
- Proposed fix: add `alter table public.rate_limits enable row level security;` (0009 + all-in-one) so only the SECURITY DEFINER `rate_limit_hit` and the service role touch it; also `revoke execute on rate_limit_hit from public` and grant only to `service_role` (or leave authenticated/anon unprivileged).

### CL-P1-5 — Retailer console devices page leaks `pin_verify` + `device_token_hash` to staff browsers
- Evidence: `web/app/(portal)/console/devices/page.tsx:21` does `supabase.from('devices').select('*').eq('retailer_id', profile.retailer_id)` with the staff JWT; `0005_rls_jwt.sql:44-48` (`devices_access` select for staff) has no column restriction. Contrast the API route that deliberately excludes them: `web/lib/apiHandlers/retailerDevices.ts:12-16` ("pin_verify and device_token_hash must not reach retailers").
- Why it matters: `pin_verify = sha256(pin + ":" + installation_id)` (`ownerPin.ts:27`) and the same row contains `installation_id` — a staff member can open devtools and brute-force a 4-8 digit PIN offline (≤10^8 SHA-256, trivial), then unlock a customer phone with the device PIN offline. Token hash exposure is lower risk (sha256 of a random token) but still unnecessary.
- Proposed fix: explicit column list on the console devices page (mirror `retailerDevices.ts`), and/or column-level grants: `revoke select (pin_verify, device_token_hash, device_pin_hash) on devices from authenticated;` in a new migration (service role unaffected). Also trim the owner `/devices` page's `select('*')` for consistency.

### CL-P1-6 — SETUP.md instructs running only 0001 → produces a broken (recursive-RLS) database and a non-functional owner
- Evidence: `SETUP.md:8` ("run supabase/migrations/0001_schema.sql"), `:13-14` (owner = sign up, then `update profiles set role='owner'`); current truth is `0000_all_in_one.sql` (`docs/BUILD_AND_DEPLOY_STEPS.md:13-14`) and `scripts/create_accounts.mjs` (which sets the app_metadata claims 0005 requires — `create_accounts.mjs:69-79, 88-103`).
- Why it matters: a fresh user following SETUP.md gets the original `actor_role()` policies (the max_stack_depth recursion 0005 exists to fix) and an owner whose JWT lacks `app_metadata.role='owner'` → dashboard/retailers/audit pages show zeros (see CL-P1-1). Setup instructions that produce a broken system is a P1 docs bug for the verification gate.
- Proposed fix: rewrite SETUP.md §1 to: run `0000_all_in_one.sql` in a NEW query tab, then `node scripts/create_accounts.mjs` (or create retailers through the portal UI once CL-P1-1 is fixed). Mention the RLS=JWT-claims consequence.

---

## P2 — polish / claim drift / robustness

### CL-P2-1 — Register can re-point an existing ACTIVE device (same retailer, cross-customer)
`web/lib/apiHandlers/register.ts:45-68`: takeover guard checks only retailer match; the upsert then overwrites `customer_id` + `device_token_hash` of any existing device of that retailer, including a live locked phone (which then loses heartbeat auth; the new device inherits the customer's commands). Needs a valid unused enrolment token + the victim's installation_id, so not remotely trivial — but the guard should also require the existing row's `customer_id` to equal the session's `customer_id` or the existing device to be unbound/released.

### CL-P2-2 — Activation consumes no credit when the session is still `created`
`web/lib/apiHandlers/heartbeat.ts:44-56`: the open-session check accepts `created`, but the activate-update only covers `installed/connected/finalizing` (`:50-53`). A device reporting `device_owner` with a `created` session gets promoted to `device_owner` with the session left `created` and zero credits consumed. Real flow usually passes through register first, but the two state lists should be identical.

### CL-P2-3 — Settled-loan LOCK supersede path writes no ack row and no ledger audit
`web/lib/apiHandlers/ack.ts:46-52`: refunds the allowance and supersedes the command, but inserts no `device_command_acks` row (unlike the main path at `:94-96`). Audit trail gap for the exact E1 gate the checklist cites.

### CL-P2-4 — LOCK allowance is only refunded when the device acks; no sweeper for never-acked commands
`commands.ts:45-56` debits at queue time; refunds exist only in `ack.ts:66-68`. A device that dies before acking leaves the allowance debited forever and the command PENDING (heartbeat delivers PENDING/RECEIVED forever). Add a cron/on-write sweeper: commands older than N hours in PENDING/RECEIVED → EXPIRED + refund once.

### CL-P2-5 — `record_payment` silently swallows overpayments
`0010_credit_lifecycle.sql:66-83`: when `amt` exceeds total remaining due, the leftover vanishes (payment row records the full amount, nothing marks the excess). Either reject overpayment with a clear error or carry a `credit_balance` on the customer. Worth a deliberate decision before launch.

### CL-P2-6 — Due-day/overdue math is UTC-based for an IST business
`retailerCustomers.ts:71-75` builds due dates from server-local time then `toISOString().slice(0,10)`; `heartbeat.ts:103` parses `due_date + 'T00:00:00'` as server-local (UTC on Vercel). "Due day 5" flips ~5.5h off Indian midnight; `overdue_days` can be one day early/late. Fix: store/parse due dates as `YYYY-MM-DD` in Asia/Calcutta consistently (or compute from due_day + a fixed offset).

### CL-P2-7 — CONTEXT.md §9 and checklist evidence are stale vs implemented code
`CONTEXT.md:177-183` still lists "TOTP at-rest encryption: TODO" (implemented: `web/lib/totpCrypto.ts` AES-256-GCM + heartbeat decrypt), "Reminder scheduling ... not wired" (wired per ledger fix wave), "Payments UI ... screens pending" (web customer detail page exists, retailer app row exists). `VERIFICATION_CHECKLIST.md:53` D11 evidence says "(at-rest encryption TODO)" — stale; `:70` F3 "screens pending" partially stale. These are exactly the "claim no longer true" items a 100/100 reviewer will flag.

### CL-P2-8 — BUILD_AND_DEPLOY_STEPS.md: stale migration count + conflicting canonical API URL
`BUILD_AND_DEPLOY_STEPS.md:13-14` says "(8 migrations)" but the all-in-one now contains 0001–0010 (its own header line 3 lists 0010); `:11` sets `EXPO_PUBLIC_API_URL=https://emidost-api.financebuddy144.workers.dev` while `CONTEXT.md:138` says `https://emidost-pd8s.vercel.app`. Reconcile with codex (which URL is live/canonical) and fix the count.

### CL-P2-9 — Root scripts don't cover the "8 tsc surfaces" the ledger claims green
`package.json:9-13` typechecks only web + shared; device-kit, the three apps, and workers are run manually. Extend `typecheck` (and add `test` wiring) so the 100/100 gate is one command.

### CL-P2-10 — `create_accounts.mjs` replaces app_metadata wholesale (drops `provider`/`providers`)
`scripts/create_accounts.mjs:100-103` PUTs `app_metadata` without `provider`/`providers`; GoTrue uses those for account linking; the account works today but merge-with-preserve is the safe pattern (same fix as CL-P1-1).

### CL-P2-11 — Web console customer detail page is orphaned
`web/app/(portal)/console/customers/[id]/page.tsx` (record payment + schedule + history) exists, but there is no `/console/customers` list page and no nav link (`web/app/(portal)/layout.tsx:27-31`), so the web payments UI is unreachable from the UI. Add a customers list (and ideally a link from console/devices rows).

### CL-P2-12 — Misc smalls
- `export const dynamic = 'force-dynamic'` in `'use client'` pages (e.g. `qr/page.tsx:7`, `console/page.tsx:7`) is ignored by Next.js — harmless but misleading; move to layout or remove.
- `ownerCredits.ts:20-22`: a missing retailer with a negative delta reports "Credits cannot go below zero" (misleading 400 instead of 404).
- `ownerTotp` + owner PIN routes lack an explicit rate limit (owner-only, low risk).
- `ack.ts` LOCATION write happens after the terminal CAS, so a LOCATION command that already failed can still store location if the device acks EXECUTED+location — acceptable but worth a comment.
- Owner `/devices` page uses the misleading path `/api/retailer/devices/command-proxy` (it is the owner handler); cosmetic.
- In-memory rate limiter is per-instance and `sharedRateLimit` fails open (`web/lib/rateLimit.ts:50-53`) — documented, fine, but note in checklist G-section for honesty.

---

## Recommended fix plan (ordered)

1. **CL-P0-1**: apply `0000_all_in_one.sql` to the live DB (lead/user action), then re-probe and update `checksum.md`. Unblocks live verification of everything else.
2. **CL-P1-4**: RLS-enable `rate_limits` (+ revoke public execute on `rate_limit_hit`); update the false comment; regenerate all-in-one. One-line SQL, security win.
3. **CL-P1-1 + CL-P2-10**: write `app_metadata` claims when the portal creates a retailer (merge provider/providers); mirror in `create_accounts.mjs`.
4. **CL-P1-5**: explicit column list in `console/devices/page.tsx` (+ owner devices page) and/or column-level revoke on `devices(pin_verify, device_token_hash, device_pin_hash)` for `authenticated`.
5. **CL-P1-3**: staff → SELECT-only on `payments`/`emi_schedules`; restrict staff UPDATE on `customers.status`; add `is_suspended` guard to staff policy branches (coordinate with codex on app write paths first).
6. **CL-P1-2**: update `checksum.md` + the stale 0001 comment to describe the real final mechanism (JWT-claim RLS), so the ledger stops contradicting the SQL.
7. **CL-P1-6**: rewrite SETUP.md §1 (all-in-one + create_accounts.mjs; no manual owner SQL).
8. P2 sweep in one wave: CL-P2-1..P2-12 (code fixes: register guard, heartbeat state lists, ack audit row, sweeper, overpayment policy, timezone; docs fixes: CONTEXT §9, checklist D11/F3, BUILD doc count+URL, root scripts, console customers list).

## Verdict on my scope

Code quality is genuinely high for this stage: web tsc 0, prod build 0, env hygiene correct, ack CAS / allowance lifecycle / payment RPC are thoughtfully designed, and the docs are unusually honest. But the scope is not yet 100/100 material: **1 P0 (operational: live DB behind migrations), 6 P1 (one wiring break for portal-created retailers, one ledger-vs-SQL contradiction, three RLS/security holes — staff write bypass, pin_verify leak to staff, rate_limits open table — and one setup doc that builds a broken system), 12 P2**. After the ordered fixes, the web/DB/docs scope should reach 95+; the remaining DEVICE/CRED/SPIKE items are outside any code agent's reach.

**Current score for this scope: 80/100** (building, honest, largely correct — but two live security holes and one broken primary flow keep it from 90).
