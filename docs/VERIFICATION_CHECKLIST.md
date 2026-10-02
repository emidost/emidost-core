# emidost verification checklist

Every item carries one of four states:
- **CODE** — implemented in this repo, checked by tsc/tests/agents.
- **DEVICE** — needs a physical phone (per-family acceptance).
- **CRED** — needs your accounts (Supabase, EAS, SMS provider).
- **SPIKE** — the Stage-1 vivo pairing spike (marked honestly, not implemented).

## A. Enrolment — kiosk install via provisioning QR (Device Owner)
| # | Item | State | Evidence |
|---|---|---|---|
| A1 | Fresh-phone preconditions documented (no accounts, no passcode, single user) | CODE | SETUP.md, QR page steps, OEM steps |
| A2 | Provisioning QR with DPC component + signature checksum | CODE | web/app/(portal)/qr/page.tsx |
| A3 | Consent: direct at the counter (customer agrees to the retailer in person); no blocking consent record — optional audit row only | CODE | enrollment route (no precondition), QR page (no gate) |
| A4 | 15-min one-time session token (hash only stored) | CODE | enrollment route + register route |
| A5 | `onProfileProvisioningComplete` finalizes (kiosk whitelist, uninstall protection, launch) | CODE | EmidostDeviceAdminReceiver.kt |
| A6 | Activation only on live OS readback (`mode=device_owner` from the phone) | CODE | heartbeat route (body.mode → session active) |
| A7 | A13+ restricted-settings + per-OEM gates in the walkthrough | CODE | shared oemMatrix + retailer app Enrol tab |
| A8 | Kiosk engages (`setLockTaskPackages`, `startLockTask`, HOME takeover) | CODE + DEVICE | LockPolicies.kt, module `enterLockTask` exported + called from customer App.tsx/LockedScreen whenever locked (`exitLockTask` on unlock); real pinning needs a device pass |

## B. Enrolment — wireless-debugging self-pair
| # | Item | State | Evidence |
|---|---|---|---|
| B1 | Pairing-code read: accessibility, settings package only, transient, 10-min expiry, cleared | CODE | EmidostAccessibilityService + AdbBridge.clear |
| B2 | Pairing handshake (ALPN adbpair SPAKE2-in-TLS): performed by the bundled AOSP adb client (Termux android-tools, Apache-2.0, source URL + sha256 + NOTICE recorded) — honestly NOT a from-scratch Kotlin SPAKE2 | CODE + DEVICE | vendor assets in packages/device-kit; per-OEM walk pending |
| B3 | pm grant ×8 + `dpm set-device-owner` + readback + debug-off cleanup, driven from the retailer app | CODE + DEVICE | EmidostAdbBridge step runner (honest per-step ok/output/readback); per-OEM walk pending |
| B4 | Fallback while the wireless path is unverified: provisioning QR (A above) | CODE | QR page |
| B5 | Staff-typed pairing code fallback (when the a11y read misses) | CODE | retailer app "Wireless enrol" flow (host/port/code entry) |

## C. FRP and protection set
| # | Item | State | Evidence |
|---|---|---|---|
| C1 | FRP accounts from env only (`EXPO_PUBLIC_FRP_ACCOUNTS`), never hard-coded | CODE | heartbeat route, sync.ts, .env.example |
| C2 | `setFactoryResetProtectionPolicy` applied at activation + restored on boot | CODE | FinancingProtection.kt |
| C3 | Honest FRP readback (OS side unverifiable → `frp_os_confirmed=false`) | CODE | FinancingProtection.status |
| C4 | Uninstall/factory-reset/safe-boot/add-user/debugging/clock blocks + user-control disable (A12+ user-control blocks are OS-restricted for some packages — the device reports the real readback, never a fake "applied") | CODE + DEVICE | FinancingProtection.kt |
| C5 | 112 stays dialable under the call block | CODE (framework rule) + DEVICE | LockPolicies + acceptance walk |

## D. Lock engine (hard-lock-only)
| # | Item | State | Evidence |
|---|---|---|---|
| D1 | LOCK refused without live Device Owner (server queue, native gate, SMS, SIM, boot) | CODE | command routes, DeviceActions.hardLock, receivers |
| D2 | Non-DO LOCK acks FAILED (no fake EXECUTED) | CODE | EmidostCommandService returns enforcement result |
| D3 | Kiosk power menu has no Reboot (GLOBAL_ACTIONS excluded; flags valid: KEYGUARD+SYSTEM_INFO) | CODE + DEVICE | LockPolicies.kt |
| D4 | REBOOT command end-to-end (owner board → commandProxy → queue): refused while locked with reason `locked_reboot_refused`; when allowed, the native side schedules the reboot ~5 s out so the EXECUTED ack lands first | CODE + DEVICE | commandProxy + owner devices page + rebootDevice |
| D5 | 2-min offline re-assert before any network call | CODE | EmidostCommandService.tick |
| D6 | Boot auto-lock (receiver + HOME takeover + cover), DO-gated | CODE | EmidostBootReceiver |
| D7 | SIM removal 30 s debounce → hard lock; SIM swap via IMSI/ICCID baseline | CODE + DEVICE | SimSentinelReceiver (baseline may be null on some devices — documented) |
| D8 | Unlock-wins watermark + SUPERSEDED acks (native AND JS paths; serverNow − elapsedDelta math) | CODE | LockStateStore.isLockStale + shared stale.ts (9/9 tests), sync.ts LOCK branch acks SUPERSEDED, ack route |
| D9 | Offline SMS LOCK/UNLOCK from retailer number + customer code; LOCK gated on DO + loan | CODE + DEVICE | EmidostSmsReceiver |
| D10 | Device PIN portal-set, offline verify, brute-force capable; hidden long-press entry on the lock screen | CODE | pin route + DevicePinStore + LockedScreen unlockWithCode |
| D11 | Offline TOTP unlock (owner-issued, audited; secret encrypted at rest with AES-256-GCM); hidden long-press entry on the lock screen; retailer Authenticator-style generator (fetches the same secret once via the unlock-key route, generates codes offline) | CODE + DEVICE | totp route + retailer unlock-key route + Totp.kt + shared totp.ts + web/lib/totpCrypto.ts + LockedScreen unlockWithCode. Honest note: a local PIN/TOTP unlock updates the device immediately; the portal lock indicator follows the next command ack/heartbeat |
| D12 | Screen PIN = force-PIN-change only (resetPassword dead on A11+) | CODE | executePinPolicy |

## E. Release, settlement, suspension
| # | Item | State | Evidence |
|---|---|---|---|
| E1 | COMPLETE/SETTLED never re-lock (server, JS, SMS, SIM, boot). Caveat (honest): the local 5-day no-internet watchdog keeps running on the device, so a settled loan offline for 5+ days can still hold a stale lock until its first online heartbeat (which releases it); offline SMS UNLOCK needs an owner-issued TOTP | CODE | ack gate, sync.ts settled branch, receivers |
| E2 | Payments settle schedules + complete the loan + release event | CODE | payments route |
| E3 | Suspended retailer: no new sessions, commands refused, heartbeat serves none | CODE | routes + heartbeat |
| E4 | Unhide "wifi" + clear protection on release | CODE | RELEASE path |

## F. Identity and UX
| # | Item | State | Evidence |
|---|---|---|---|
| F1 | Customer app named "wifi"; hidden from launcher after activation; unhidden on release | CODE + DEVICE | app.json, sync.ts hideSelf |
| F2 | Colorful per-role design + Lucide icons + sentence-case humanizer copy | CODE | apps |
| F3 | Consent + payments UI | CODE — web console customer page (record payment + history + schedule) and retailer app inline Record-payment row; consent is taken directly at the counter, an optional audit row API exists (no blocking record) |
| F4 | Customer photo: retailer upload at registration (API route, JPEG/PNG/WebP ≤ 2 MB, private bucket, service role only), signed URL minted by the heartbeat, cached on the phone for offline use | CODE | 0014_customer_photos.sql + customerPhoto route + heartbeat photo_url. Honest note: Android notification images need a remote URL, so the photo shows on the lock screen the reminder opens, not inside the notification itself |

## G. Performance
| # | Item | State | Evidence |
|---|---|---|---|
| G1 | 13 hot-path indexes | CODE — applied live via the all-in-one | 0002_perf_indexes.sql |
| G2 | Heartbeat parallelized (2 waves) + single-flight app loop | CODE | heartbeat route, App.tsx |
| G3 | FlatList virtualization in retailer/owner lists | CODE | retailer App.tsx (Customers/Devices) + owner App.tsx (Retailers/Audit) use FlatList with keyExtractor + empty states |

Rate-limit honesty note: the per-IP/per-installation limiter is in-memory
(per serverless instance) and the cross-instance Supabase limiter fails open
when the DB is unreachable; the `rate_limits` table itself is closed to
non-service roles (0011). Swap the in-memory limiter for Upstash before scale.

## H. Acceptance walks (per OEM family; a family is "works" only after a real pass)
| # | Walk | State |
|---|---|---|
| H1 | Enrol via QR (A) → Device Owner readback → hidden "wifi" | DEVICE |
| H2 | LOCK → kiosk pins, PIN cannot leave, power menu has no Reboot, 112 dials | DEVICE |
| H3 | SIM out → lock ≤30 s; SIM swap → lock | DEVICE |
| H4 | Reboot → auto-lock; battery-pull → auto-lock | DEVICE |
| H5 | Offline SMS LOCK/UNLOCK from the retailer number | DEVICE |
| H6 | UNLOCK/RELEASE → fully released, app unhidden, no re-lock | DEVICE |
| H7 | Paid loan (COMPLETE) → never re-locks | DEVICE |
| H8 | Wireless self-pair (B): pair → connect → pm grant → dpm set-device-owner → DO readback → debug off → app hidden, on vivo (or any first certified family) | CODE + DEVICE |

## I. Deployment gates (all yours, none done)
| # | Item | State |
|---|---|---|
| I1 | Supabase project + migrations: live DB verified by the acceptance run (2026-10-03) to have 0001–0016 (rate_limits RLS blocks anon writes, FCM columns, photo bucket, escalation column, ALERT/REMIND enums, overpayment guard). PENDING SQL: run 0017 (retailer_sales sales ledger; or the all-in-one) in a NEW query tab | CRED (one query tab left) |
| I2 | EAS account + first builds (owner/retailer/customer) + Kotlin Gradle pass | CRED |
| I3 | SMS provider (if SMS commands are used beyond the local receiver) | CRED |
| I4 | GitHub release hosting for the customer APK (QR download link) | CRED |
| I5 | No deployment until you confirm | — |

## J. Push acceleration (FCM kick)
| # | Item | State | Evidence |
|---|---|---|---|
| J1 | FCM/Expo token stored server-side (`devices.fcm_token` + updated_at); column revoked from anon/authenticated (service role only) | CODE | 0013_fcm_tokens.sql; register.ts + heartbeat.ts store/rotate/clear it |
| J2 | Kick sent after command insert on both command paths (retailer + owner), best-effort, never blocks or fails the command; failures logged, `push_kick` in audit detail | CODE | commands.ts, commandProxy.ts, web/lib/fcm.ts |
| J3 | Wake-only: the push payload is data-only `{ type: 'kick' }` with no command content; Supabase stays the source of truth | CODE | web/lib/fcm.ts sendKick |
| J4 | Fallback intact: heartbeat poll + SMS unchanged; a phone with no token rides polling; RELEASE clears the token | CODE | heartbeat.ts, ack.ts RELEASE branch |
| J5 | Real-device wake latency (data-only background delivery on OEMs without Play Services) | DEVICE | per-family walk |

## K. Overdue escalation
| # | Item | State | Evidence |
|---|---|---|---|
| K1 | Due-day schedule: 3 AUTOMATIC notifications at 10:00, 14:00, 20:00 local. The old automatic −3/−1/+1/+3 schedule is REMOVED (reminder control shift): pre-due reminders are retailer-triggered only — the online REMIND command or the offline SMS `REMIND <code>` (friendly bn/hi voice + notification, no allowance, refused on settled loans) | CODE | customer app schedule + commands.ts REMIND + SMS receiver (codex) |
| K2 | Overdue days 1–5: every 30 min one notification + "EMI is overdue" in Bengali then Hindi, 3 times per trigger, via app-level TTS; media volume maxed while overdue with DISALLOW_ADJUST_VOLUME (cleared on payment) | CODE + DEVICE | native escalation loop (codex). Honest limit: a hardware mute switch still cuts output; DND access is optional per OEM |
| K3 | Portal kill-switch (`customers.overdue_escalation_enabled`, default true, audited) + retailer ALERT and REMIND commands (one-shot voices, no allowance, refused on settled loans). Retailer-triggered REMIND/ALERT/LOCATION work even with the switch off (deliberate retailer action beats the toggle; automatic escalation respects it) | CODE | 0015 + 0016 + customerEscalation PATCH + console toggle + commands.ts ALERT/REMIND |
| K4 | Overdue day 3+ without payment: GPS once per window (10:00–12:00 and 18:00–20:00, stable random minute) + SMS to the retailer's number with a Google Maps link (https://maps.google.com/?q=lat,lng); gated on escalation_enabled + loan outstanding; applies to notify_only plans too | CODE + DEVICE | native windows (codex). Honest note: sent by the phone itself using the customer's SMS balance (documented) |
| K5 | Privacy: toggle audited (`ESCALATION_TOGGLED`), escalation delivered via the authenticated heartbeat, consent is the documented counter rule | CODE | customerEscalation.ts + heartbeat escalation_enabled |
| K6 | Offline + overdue 4 days (no server contact for 4 days while overdue, cached or computed from the IST due date) → local hard lock (`overdue-offline-watchdog-4d`), lock plans only, NOT gated by the kill-switch; the 5-day no-internet watchdog stays as the outer bound | CODE + DEVICE | SyncStateStore.overdueOfflineLockDue + JS mirror. Honest note: a settled-while-offline phone can still hold the stale lock until its first heartbeat; the TOTP SMS unlock always wins |

## L. Owner sales ledger
| # | Item | State | Evidence |
|---|---|---|---|
| L1 | Sale recorded: invoice row (`retailer_sales`, server-generated `EMD-INV-*`, unique), lock allowances granted in bulk (`add_lock_allowances`), device credits granted via `adjust_credits`, `kind='sale'` ledger rows carrying `sale_id`, `SALE_RECORDED` audit; compensating rollback on any failed step (logged) | CODE | 0017_retailer_sales.sql + ownerSales.ts POST |
| L2 | Totals + per-retailer summary (sales count, units, revenue, collected, outstanding, last sale) and the filterable sales history | CODE | ownerSales.ts GET + summaryGET + web/app/(portal)/sales/page.tsx |
| L3 | Staff can read their OWN retailer's purchases (RLS with the live suspension guard); owner full access via JWT claim | CODE | 0017 RLS policies |
