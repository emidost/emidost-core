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
| B2 | Kotlin SPAKE2 self-pair (ALPN adbpair, hairpin loopback) | **SPIKE — NOT implemented** | EmidostAdbBridge reports implemented=false |
| B3 | pm grant ×8 + `dpm set-device-owner` + readback + debug-off cleanup | SPIKE | AdbBridge skeleton |
| B4 | Fallback while the spike is pending: provisioning QR (A above) | CODE | QR page |
| B5 | Staff-typed pairing code fallback (when the a11y read misses) | CODE (UI stub) | retailer Enrol tab text; keypad UI is a follow-up |

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
| D4 | REBOOT command refused while locked | CODE | module rebootDevice |
| D5 | 2-min offline re-assert before any network call | CODE | EmidostCommandService.tick |
| D6 | Boot auto-lock (receiver + HOME takeover + cover), DO-gated | CODE | EmidostBootReceiver |
| D7 | SIM removal 30 s debounce → hard lock; SIM swap via IMSI/ICCID baseline | CODE + DEVICE | SimSentinelReceiver (baseline may be null on some devices — documented) |
| D8 | Unlock-wins watermark + SUPERSEDED acks (native AND JS paths; serverNow − elapsedDelta math) | CODE | LockStateStore.isLockStale + shared stale.ts (9/9 tests), sync.ts LOCK branch acks SUPERSEDED, ack route |
| D9 | Offline SMS LOCK/UNLOCK from retailer number + customer code; LOCK gated on DO + loan | CODE + DEVICE | EmidostSmsReceiver |
| D10 | Device PIN portal-set, offline verify, brute-force capable; hidden long-press entry on the lock screen | CODE | pin route + DevicePinStore + LockedScreen unlockWithCode |
| D11 | Offline TOTP unlock (owner-issued, audited; secret encrypted at rest with AES-256-GCM); hidden long-press entry on the lock screen | CODE + DEVICE | totp route + Totp.kt + web/lib/totpCrypto.ts + LockedScreen unlockWithCode. Honest note: a local PIN/TOTP unlock updates the device immediately; the portal lock indicator follows the next command ack/heartbeat |
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

## G. Performance
| # | Item | State | Evidence |
|---|---|---|---|
| G1 | 13 hot-path indexes | CODE (apply on the new DB) | 0002_perf_indexes.sql |
| G2 | Heartbeat parallelized (2 waves) + single-flight app loop | CODE | heartbeat route, App.tsx |
| G3 | FlatList virtualization in retailer/owner lists | Follow-up | noted |

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
| H8 | Wireless self-pair (B) spike on vivo | SPIKE |

## I. Deployment gates (all yours, none done)
| # | Item | State |
|---|---|---|
| I1 | New Supabase project + migration 0001/0002 applied | CRED |
| I2 | EAS account + first builds (owner/retailer/customer) + Kotlin Gradle pass | CRED |
| I3 | SMS provider (if SMS commands are used beyond the local receiver) | CRED |
| I4 | GitHub release hosting for the customer APK (QR download link) | CRED |
| I5 | No deployment until you confirm | — |
