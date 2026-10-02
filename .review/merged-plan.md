# Merged decision — lead + claude + codex (2026-10-03)

Target: 100/100 on `docs/VERIFICATION_CHECKLIST.md` for everything achievable in
code, all checks green, honest reporting of DEVICE/CRED/SPIKE items.

## Facts established (lead live probes, read-only)

- Live Supabase DB is ALREADY fully migrated: all 10 tables (incl. `rate_limits`),
  `customers.lock_mode`, `LOCATION` enum, RPCs `record_payment`, `rate_limit_hit`,
  `consume/refund/release_device_credit`, `adjust_credits` all present.
  → CL-P0-1 is resolved operationally; only the ledger needed updating.
- Live `rate_limits` is EMPTY but has NO RLS (0009 as applied lacks
  `enable row level security`) → CL-P1-4 is a LIVE hole until the user runs the
  fixed SQL. No Supabase CLI/PAT exists locally → live DDL is a user step.
- Anon probes: `devices`/`payments` SELECT → `[]` (RLS works).
- Portal https://emidost-pd8s.vercel.app responds 200.
- Baseline: all 8 tsc surfaces + stale tests 6/6 + landing tsc = GREEN.

## Decisions (contested points)

1. **CL-P1-3 tightening**: staff = SELECT-only on `payments`, `emi_schedules`,
   `devices`; `customers` = SELECT-only for staff (all mutations via API).
   Verified: retailer app + web console only READ via supabase-js; writes go
   through the Vercel API. Add `is_suspended` guard (own profile subquery) to
   staff branches.
2. **CL-P1-4**: new migration `0011_rate_limits_rls.sql`
   (enable RLS + revoke public execute on `rate_limit_hit`, grant service_role)
   + regenerate all-in-one. Live application = USER step (one query tab).
3. **CL-P2-5**: `record_payment` REJECTS overpayments (400, clear message).
4. **CL-P2-4**: lazy sweeper in heartbeat delivery — PENDING/RECEIVED commands
   older than 24 h → EXPIRED + one-time allowance refund.
5. **CL-P2-8**: canonical API URL = https://emidost-pd8s.vercel.app (probed).
6. **CX-6**: hidden PIN/TOTP entry = long-press on the lock emblem on
   LockedScreen (matches 3-tap diagnostics pattern); a11y docblock fixed to
   match reality.
7. **CX-14**: keep `dataSync` FGS, log start failures, document the A15 cap
   honestly (HOME-app mitigates).
8. **CX-15**: `Build.VERSION.SDK_INT >= N` guards (minSdk 23).

## Scope split (disjoint write scopes)

- **claude**: `web/`, `supabase/migrations/`, `scripts/`, root `package.json`,
  `docs/` + `CONTEXT.md` + `SETUP.md` + `checksum.md` + `README.md`,
  `web/.env.example`.
- **codex**: `apps/`, `packages/shared/`, `packages/device-kit/`, `workers/`,
  `apps/customer/.env.example`.
- **lead**: merged plan, final verification (all 9 surfaces + tests + build +
  live re-probe), score report.

## claude implementation list

P1: CL-P1-4 (0011 + all-in-one) · CL-P1-3 (0005 + all-in-one) · CL-P1-1 +
CL-P2-10 (ownerRetailers.ts app_metadata merge; create_accounts.mjs merge) ·
CL-P1-5 (explicit columns on console/devices + owner devices pages) ·
CL-P1-2 (checksum.md + stale 0001 comment) · CL-P1-6 (SETUP.md §1).
P2: CL-P2-1 (register cross-customer guard) · CL-P2-2 (heartbeat activate covers
'created') · CL-P2-3 (settled supersede writes ack row) · CL-P2-4 (lazy
sweeper) · CL-P2-5 (overpayment reject) · CL-P2-6 (Asia/Calcutta due dates) ·
CL-P2-7 (CONTEXT §9 + checklist D11/F3) · CL-P2-8 (BUILD doc count+URL) ·
CL-P2-9 (root typecheck all 8 + test) · CL-P2-11 (console customers list page +
nav) · CL-P2-12 misc.
From codex (docs-side): CX-10 (heartbeat returns `is_locked`) · CX-11 (SETUP.md
§5 SMS syntax) · CX-17 (E1 watchdog note) · CX-16 (C4 user-control caveat note).
Ledger: new checksum.md entry recording live-DB probe (already migrated),
remaining user actions (run 0011, EAS builds, device walks).

## codex implementation list

P0: CX-1 (export + call `enterLockTask` when locked: App.tsx + LockedScreen) ·
CX-2 (staleness + SUPERSEDED ack in sync.ts LOCK branch; native
`lastUnlockElapsed`/`boot` readback in getDeviceManagementStatus).
P1: CX-3 (stale.ts → serverNow − elapsedDelta + tests) · CX-4 (lock_mode gate
SIM sentinel + SMS LOCK) · CX-5 (AIRPLANE_MODE_CHANGED) · CX-6 (hidden PIN/TOTP
entry on LockedScreen + a11y docblock).
P2: CX-7 (manifest permission) · CX-8 (apps .env.example FRP placeholder) ·
CX-9 (HeartbeatResponse type + typed pollOnce) · CX-10 (CachedState is_locked) ·
CX-12 (Enrol tab brand wiring) · CX-13 (createCustomer lock_mode type) ·
CX-14 (FGS log + honest doc) · CX-15 (API 24 guards) · CX-16 (status()
user_control readback) · CX-18 (comments + DeviceStatus.kioskActive +
getOemProfile args + test rework).

## Verification gate (lead)

All 8 tsc surfaces + workers + landing + tests 6/6 (re-run after fixes) +
`next build` + live DB re-probe. Final score written in checksum.md + report.
