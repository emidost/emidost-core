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
  `1778c6f`.

## Honest limits and residuals (nothing here is hidden)

1. **`0011_rate_limits_rls.sql` is not yet applied to the live database.**
   Until the user runs it in a query tab, the live `rate_limits` table has no
   RLS (it is empty today; the limiter still works, the table is just not
   closed). This is the only un-applied hardening statement.
2. **Physical acceptance is pending.** Every CODE + DEVICE item above needs a
   real per-OEM walk (enrol → lock → 112 dials → SIM pull → reboot → SMS →
   release). No family is certified until then.
3. **`rebootDevice` has no UI caller.** The REBOOT command is refused while
   locked at the API surface (D4), but no screen currently sends a REBOOT, so
   the guard is defense-in-depth, not an exercised path.
4. **Code unlock and the portal indicator.** A PIN/TOTP code unlock frees the
   phone immediately; the server's `devices.is_locked` flips on the next
   command ack/poll. If the portal must show it instantly, a heartbeat-reported
   lock-state write is a small follow-up.
5. **Rate limiter is per-instance and fails open.** The in-memory limiter is
   per serverless instance; the shared Supabase limiter fails open when the
   DB is unreachable. Documented; Upstash/WAF is the scale answer.
6. **SMS is not cryptographically authenticated.** The sender allowlist is
   spoofable; that is why SMS LOCK additionally requires live Device Owner +
   outstanding loan + lock_mode, and SMS UNLOCK requires the owner-issued
   8-digit TOTP. Documented in SETUP.md.
7. **5-day watchdog vs settlement.** A loan settled while the phone is offline
   5+ days can hold a stale local lock until its first online heartbeat
   releases it; the SMS TOTP unlock is the offline escape hatch. Documented.
8. **Wireless-debugging self-pair is a skeleton.** `EmidostAdbBridge` honestly
   reports `implemented=false`; the provisioning QR is the working enrolment
   path (SPAKE2 spike pending a vivo device).
9. **Kotlin compiles only in an EAS build.** No local JDK/SDK here; the code is
   reviewed compile-clean by inspection, and the real proof is the first EAS
   Gradle build.
10. **Worker parity needs a redeploy.** The Cloudflare worker reuses the web
    handlers, so `wrangler deploy` picks up today's routes (including
    `unlock-key`); until then only Vercel serves them.

## Standing user actions (unchanged from the ledger)

1. Run `supabase/migrations/0011_rate_limits_rls.sql` (or the regenerated
   all-in-one) in a NEW query tab.
2. EAS builds (customer first, then retailer, then owner) + GitHub release for
   the APK download links.
3. Per-family device acceptance walks, recorded in `checksum.md`.
