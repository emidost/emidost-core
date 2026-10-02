# emidost admin portal: setup, login ID and password guide

Everything you need to go from a fresh Supabase project to logging into the
owner portal, and to create retailer logins from inside it. Commands are
Windows PowerShell, run from the repo root `D:\emidost` unless stated.

---

## Part 1. One-time database setup

1. Supabase dashboard → your project (ref `fhmndtznwtchqrfuobyq`) → **SQL Editor**.
2. **New query tab** → paste the whole of
   `supabase/migrations/0000_all_in_one.sql` → **Run**.
   It is idempotent (safe to re-run) and covers schema 0001-0016: tables, RLS,
   credit/allowance RPCs, rate limits, `fcm_token`, the photo bucket, the
   escalation column and the REBOOT/ALERT/REMIND command types.
3. Confirm: Table Editor shows 15 tables (`profiles`, `retailers`,
   `customers`, `devices`, `payments`, ...) and Storage shows the private
   `customer-photos` bucket.

## Part 2. Wire the keys (never commit them)

1. Supabase → **Project Settings → API**. Copy three values.
2. Create/edit `D:\emidost\web\.env.local`:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://fhmndtznwtchqrfuobyq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key, server only>
NEXT_PUBLIC_APP_URL=https://emidost-pd8s.vercel.app
```

`web/.env.local` is gitignored. The service-role key must never reach an app
or a browser.

## Part 3. Create the admin (owner) and a demo retailer login

The SQL editor cannot write `auth.users`, so accounts come from the admin API
script:

```powershell
node scripts/create_accounts.mjs
```

It reads the keys from `web/.env.local` and creates:

| Role | Login ID | Password | Notes |
|---|---|---|---|
| **Owner (admin)** | `dip@emidost.in` | **yours to choose** | full portal access |
| Retailer staff | `retailer@emidost.in` | `Retailer@Pass123` | bound to "Demo Phone House" |
| Demo customer row | (no login) | (no login) | customers never have logins |

It also writes the JWT `app_metadata` claims (`role`, `retailer_id`) that RLS
reads, gives the demo retailer 10 device credits and 50 lock allowances, and
adds one demo customer plus its EMI schedule.

### Choose the owner password

The admin password is not stored in the repo. Set it with:

```powershell
node scripts/set_owner.mjs --password "YourStrongPassword"
```

`set_owner.mjs` is idempotent: it creates the owner if missing, renames a
legacy `owner@emidost.in` to `dip@emidost.in` (keeping the same user id, so
every `retailer.owner_id` link survives), merges the `owner` claim, ensures the
profile row, and updates the password only when you pass one. Run it with no
arguments to just verify the account:

```powershell
node scripts/set_owner.mjs
# owner login : dip@emidost.in
# role claim  : owner
# password    : unchanged
```

On a fresh project you can also pass `OWNER_PASSWORD` to the bootstrap script:
`$env:OWNER_PASSWORD="YourStrongPassword"; node scripts/create_accounts.mjs`

Notes:
- The script is **one-shot**: re-running fails on the duplicate email
  (`422 ... already registered`). To add more accounts, use the portal
  (Part 5) or the admin API.
- The owner account in this project is **already live as `dip@emidost.in`**
  (renamed from the legacy `owner@emidost.in` with the same user id).
  Until you run `set_owner.mjs --password`, it still has the documented
  default password, so set yours before launch.
- **Change the retailer password** after the first login too; it is documented
  and therefore public.

## Part 4. Log in to the admin portal

1. Open **https://emidost-pd8s.vercel.app** (this is the owner portal).
   Local alternative: `npm run dev:web` in `D:\emidost`, then
   http://localhost:3000.
2. Enter the owner login ID and password on the login page.
3. The portal redirects by role: **owner → `/dashboard`**, **retailer staff →
   `/console`**. A suspended account is redirected back to login.
4. If the account's JWT claims are missing (for example an account created by
   hand in the dashboard), the portal backfills them on first login
   (`web/app/page.tsx`) and logs `[auth-self-heal]`.

What the owner sees: dashboard counts, **Retailers** (create/suspend, credits,
lock allowances), **Devices** (board, LOCK/UNLOCK/REBOOT, PIN, TOTP), **Audit**
(every action), **Enrolment QR**.

## Part 5. Create a retailer login from the portal (the normal way)

1. Log in as owner → **Retailers** → **New retailer**.
2. Fill in: **name**, **phone** (the SMS sender number), **login ID** (an email
   address), and a **password of at least 8 characters**.
3. Submit. The portal creates the auth user, the retailer row, the staff
   profile and the JWT claims in one compensating step; a later failure rolls
   the earlier rows back (failures are logged as `[retailer-create] rollback`).
4. Give that login ID + password to your shop staff. They sign in at the same
   portal URL, or in the **retailer Android app** with the same credentials.
5. Set their **credits** (device slots) and **lock allowances** from the
   Retailers list before they enrol phones.

## Part 6. Change or reset a password

There is **no self-service "forgot password" page yet** (honest gap). Use one of:

**A. Supabase dashboard (easiest)**
Authentication → Users → pick the user → **⋯ → Reset password** (sends an
email, requires the mail provider to be configured) or **Update user → new
password** (immediate).

**B. Admin API (no email needed)**

```powershell
$E = @{}
foreach ($l in Get-Content web\.env.local) { if ($l -match '^([A-Z0-9_]+)=(.*)$') { $E[$matches[1]] = $matches[2].Trim() } }
$sb = $E['NEXT_PUBLIC_SUPABASE_URL']; $svc = $E['SUPABASE_SERVICE_ROLE_KEY']
# find the user id by email
curl.exe -s "$sb/auth/v1/admin/users" -H "apikey: $svc" -H "authorization: Bearer $svc" |
  Select-String -Pattern 'owner@emidost.in'
# then update the password
curl.exe -s -X PUT "$sb/auth/v1/admin/users/<USER_ID>" -H "apikey: $svc" -H "authorization: Bearer $svc" -H "content-type: application/json" -d '{\"password\":\"NewStrongPass123\"}'
```

After a password or role change, log out and back in so the JWT carries the
new claims.

## Part 7. Suspending and restoring a retailer

Portal → Retailers → the retailer row → **Suspend** / **Resume**. Suspension is
checked live on every request (and in RLS), so a suspended shop cannot start
enrolments, queue commands, or read its data, while its already-enrolled phones
stay owner-managed. Every suspend/resume lands in the Audit feed.

## Part 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Invalid login credentials" | wrong password, or the user was never created | re-run Part 3, or reset the password (Part 6) |
| Login works but every page shows zeros | JWT `app_metadata` claims missing | now self-heals on login; otherwise re-run Part 3 and log out/in |
| 401 on API calls from the apps | old deployed portal without the bearer-auth fix | redeploy the portal (the fix is committed as `f8fcae0`) |
| Table errors like `column lock_mode does not exist` | SQL not applied | run Part 1 |
| `rate_limits` readable with the anon key | migration 0011 not applied | run Part 1 |
| Retailer can log in but sees another shop's data | impossible by design (RLS + route tenant checks) | report it; check the profile `retailer_id` |
| Account suspended | owner suspended it | Retailers → Resume |

## Part 9. Pre-launch security checklist

- [ ] Owner and retailer passwords changed from the documented defaults.
- [ ] `web/.env.local` and `apps/*/.env` are never committed (they are gitignored).
- [ ] Service-role key exists only in server env (Vercel/worker secrets), never in an app.
- [ ] `0000_all_in_one.sql` applied (0011-0016 included) and the portal redeployed.
- [ ] Owner account: exactly one, created by script or portal, with claims.
- [ ] Audit feed reviewed after the first real retailer is created.
