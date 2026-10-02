# Offline unlock — retailer Authenticator-style TOTP generator (lead decision)

Requested: the retailer app must have a Google Authenticator-style offline
unlock code generator the retailer hands to the customer, whose locked phone
may be offline.

## Design (lead decision)

- The device already verifies RFC 6238 TOTP locally (`Totp.kt`: HMAC-SHA1,
  8 digits, 30 s, ±1 window, base64 secret) and has a hidden long-press PIN/TOTP
  entry on the lock screen (CX-6). NO device-side changes needed.
- The secret is minted/stored server-side (`totp_secrets.secret_enc`,
  AES-256-GCM) and delivered to the phone via heartbeat. The retailer app must
  hold the SAME secret to generate matching codes.
- New API: `POST /api/retailer/devices/:id/unlock-key` — retailer-staff only,
  suspension-gated, device must belong to the retailer.
  - 200 `{ secret: "<base64>", period: 30, digits: 8 }` (the same base64 string
    the device stores and verifies)
  - 409 `{ error: "no_unlock_key" }` when the device has no secret yet — do NOT
    mint one here: a minted secret could never reach an offline locked phone.
    Message: the phone must complete one online heartbeat first.
  - Audit row `TOTP_KEY_ISSUED_RETAILER` with device_id.
- Retailer app: fetch once (online) → cache in expo-secure-store → generate
  codes locally forever (Authenticator style: big 8-digit code, 30 s countdown
  ring, copy button, auto-regenerate). Fully offline after first fetch.
- Shared generator `packages/shared/src/totp.ts` mirrors `Totp.kt` exactly;
  jsSHA provides HMAC-SHA1 in Hermes. RFC 6238 test vectors + node:crypto
  cross-check tests.

## Write scopes (disjoint)

- claude: web/ (new handler + dispatch), CONTEXT.md, SETUP.md, docs/VERIFICATION_CHECKLIST.md, checksum.md.
- codex: packages/shared/ (totp.ts + tests + api.ts), apps/retailer/, workers/src/index.ts (dispatch parity line).

## Contract

Route: POST /api/retailer/devices/{id}/unlock-key (4 segments).
Auth: existing Bearer JWT (same as other retailer routes).
Statuses: 401 unauthenticated · 403 non-staff / suspended · 404 device not
found or not this retailer's · 409 no_unlock_key · 500 secret unreadable.
Response shape above. Client method name: `getDeviceUnlockKey(deviceId)`.
