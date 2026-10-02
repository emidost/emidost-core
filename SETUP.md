# emidost setup

Steps that need YOUR accounts. The repo ships with placeholders only; no real credentials are committed.

## 1. Supabase (new project)

1. Create a new Supabase project. Note the project ref.
2. SQL: open the SQL editor in a NEW query tab and run the single file
   `supabase/migrations/0000_all_in_one.sql` (schema + indexes + hardening +
   JWT RLS + retention + lock modes + refunds + rate limits + atomic
   payments). It is idempotent: safe to re-run.
3. Copy values into the env files (see section 4):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only; never ship to a client app)
4. Auth: enable email+password (phone OTP optional). Create the accounts:
   `node scripts/create_accounts.mjs` (reads `web/.env.local`; creates the
   owner, a retailer + staff login, and a demo customer). Do NOT create the
   owner by signing up and editing profiles by hand: RLS reads the role from
   the JWT `app_metadata` claim, which only the script (or the portal's
   "Add retailer" form) writes.
5. Realtime is optional; the portal polls.

## 2. Expo / EAS (new account)

1. `npm i -g eas-cli` then `eas login` with the new account in each of `apps/owner`, `apps/retailer`, `apps/customer`.
2. `eas build -p android --profile <owner|retailer|customer>` per app (profiles exist in each app's `eas.json`).
3. The customer APK is the DPC. Its package is `com.emidost.customer` and the admin component is `com.emidost.customer/com.emidost.devicemanagement.EmidostDeviceAdminReceiver`. These feed the provisioning QR page (web portal → Enrolment).
4. Signing-cert SHA-256 (for the provisioning QR checksum): `eas credentials` → Android keystore → SHA-256 fingerprint. Enter it on the QR page; it is remembered on that browser.

## 3. FRP account (yours, from the earlier project)

`EXPO_PUBLIC_FRP_ACCOUNTS=106892760455009935120` is your Google account's people-API ID. It is applied via `setFactoryResetProtectionPolicy` at activation and re-applied on boot. Keep it only in env; it is never hard-coded.

## 4. Env files

Copy each `.env.example` next to its app as `.env` (Expo reads `.env`) and `.env.local` (Next reads `.env.local`):

- `web/.env.example` — portal
- `apps/owner/.env.example`, `apps/retailer/.env.example`, `apps/customer/.env.example` — Expo apps (EXPO_PUBLIC_* only; never the service role)

## 5. SMS commands (retailer offline lock/unlock)

The retailer's registered phone number is the SMS sender allowlist. Commands:
`LOCK <customer-code>` and `UNLOCK <customer-code> <totp>` — an 8-digit TOTP
issued by the owner for that device is required to unlock by SMS. The retailer
app can also generate the offline unlock code itself (Authenticator style,
cached after one online fetch); SMS UNLOCK needs the same TOTP. SMS is not
cryptographically authenticated: the customer code and the device PIN/TOTP
paths are the authenticated factors. An SMS gateway/aggregator is not
included; choose one and keep costs in mind. Android 14+ delivery restrictions
must be verified per device family.

## 6. Device acceptance (required before calling any family "working")

Per family: fresh reset, no accounts, no passcode → enrol → lock → 112 dials → SIM out locks within 30 s → reboot auto-locks → power menu has no Reboot → offline SMS LOCK/UNLOCK from the retailer number works → release unhides the app. Record model, firmware, build id in `checksum.md`.

Wireless path (B) walk, same per-family rule: overlay grant + accessibility toggle → wireless debugging on → pairing code read/shown → retailer app `adb pair`/`connect` → pm grants → `dpm set-device-owner` → `dpm list device-owners` readback shows the component → debug-off cleanup confirms `adb_enabled 0` → app hidden. A family counts as "working" only after this passes on a real device.

## 7. What is NOT shipped

No real Supabase/EAS/SMS credentials, no deployment config, no releases. Deployment requires explicit confirmation.
