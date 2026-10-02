# emidost function report — every function, how it works, what it prevents

Merged claim-by-claim report, compiled 2026-10-03 by the lead from two
independently audited halves (claude: web portal + API + SQL, 39 functions;
codex: apps + device-kit + shared + worker, 74 functions). Every line
reference was re-verified against the tree at commit `1778c6f`.

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

What this report does NOT claim: physical-device acceptance (per-OEM walks),
EAS-built APKs, the SPAKE2 wireless self-pair spike, and the one pending SQL
statement on the live database (`0011`). Those are listed explicitly in the
honest-limits section at the end; everything else below is code that was
checked, not marketing.
