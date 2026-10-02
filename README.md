# emidost

Financed-phone EMI lock system. Three roles, one backend:

- **Owner** — web portal + Android app. Manages retailers, credits (device slots), lock allowances, suspends accounts, watches devices, audits everything.
- **Retailer** — Android app. Registers customers, records payments, walks a per-brand setup wizard, generates the enrolment QRs, locks/unlocks within allowances, sends offline SMS lock/unlock from the registered number.
- **Customer** — Android app installed on the financed phone. Launcher name "wifi". Runs the full hard-lock engine (Device Owner only), lock screen shows the customer photo, reminders carry Bengali/Hindi voice + text, retailer contact, offline SMS lock/unlock, offline TOTP. Hidden from the app drawer after setup; unhidden on release.

## Layout

| Path | What |
|---|---|
| `web/` | Next.js portal (owner + retailer consoles, device API) |
| `apps/owner` `apps/retailer` `apps/customer` | Expo Android apps |
| `packages/shared` | Types, API client, OEM matrix, copy rules |
| `packages/device-kit` | Expo native module (DevicePolicyManager, adb self-pair bridge, accessibility, command service, SIM sentinel, overlay) |
| `supabase/migrations` | Idempotent SQL for a fresh Supabase project |

## Setup

Read `SETUP.md`. Everything credential-dependent (Supabase project, EAS account, FRP Google account ID, SMS provider) is described there; nothing in this repo contains a real secret.

## Honest limits

Locking requires Device Owner enrolment. Device-owner features are marked untested until a physical device passes the per-family acceptance walk (see `packages/shared/src/oemMatrix.ts` and SETUP.md). `resetPassword()` is unavailable to Device Owner apps on Android 11+, so the screen PIN feature is a force-PIN-change policy, not a remote PIN set.
