# Build and deploy steps (customer first, then owner, then retailer)

Rule in force: customer APK exists and is verified BEFORE the retailer build
starts, because the provisioning QR must embed the real APK download link and
signing checksum. Owner app is private to the business owner.

## 0. One-time prep (already done for you)
- EAS projects: owner on your personal account; retailer + customer on the
  emidost team account.
- Env vars already set per project in the EAS dashboard:
  EXPO_PUBLIC_API_URL=https://emidost-api.financebuddy144.workers.dev
  Customer also needs EXPO_PUBLIC_FRP_ACCOUNTS=106892760455009935120
- SQL: run the single supabase/migrations/0000_all_in_one.sql in a NEW Supabase
  query tab (8 migrations) before the first phone enrolment.

## 1. Build the customer APK
```
cd D:\emidost\apps\customer
npx eas-cli login        (team account; browser approves)
npx eas-cli build -p android --profile customer
```
- Choose "apk" when asked (profile already sets buildType apk).
- The first build uploads the whole project (3-10 min), then Gradle compiles
  the device-kit Kotlin on EAS (this is also the Kotlin compile proof).
- Result: an EAS build page with an APK download link.

## 2. Verify the customer app (on a real phone)
Install the APK. Walk this list and tick each:
- [ ] App icon says "wifi" (the customer-facing name).
- [ ] First open shows the bind screen (no crash).
- [ ] Full lock screen spec: 96px amount, pay now, call retailer, 112,
      en/bn/hi chips, breathing ring.
- [ ] The diagnostics section stays hidden until the version line is tapped
      three times.
- [ ] Airplane mode: the app shows the cached EMI info and no crash.
- [ ] SMS LOCK/UNLOCK from the retailer number works (UNLOCK needs the code
      + current TOTP; LOCK needs the code).
- [ ] Reboot while locked: the lock returns by itself.
- [ ] SIM out for 30+ seconds while loan outstanding: the phone locks.
- [ ] 5-day offline watchdog: check the counter logic in code review only
      (do not wait 5 days); confirm with me if you want a 5-minute test build.
If anything fails, tell me exactly what you see and I fix it before the next
build.

## 3. Build and verify the owner app
```
cd D:\emidost\apps\owner
npx eas-cli login        (your PERSONAL account)
npx eas-cli build -p android --profile owner
```
Verify: login as owner@emidost.in, dashboard numbers, add-retailer form,
credits/allowances, suspend/unsuspend, QR page. Tell me what to change; I fix,
you rebuild until you approve.

## 4. Only after both are approved: retailer build
```
cd D:\emidost\apps\retailer
npx eas-cli login        (team account)
npx eas-cli build -p android --profile retailer
```
Before this: upload the customer APK to the GitHub release (emidost/emidost
repo, tag v1.0.0, file emidost-customer.apk) so the landing download button
resolves, then paste into the portal QR page:
- APK download URL: https://github.com/emidost/emidost/releases/latest/download/emidost-customer.apk
- Signing checksum: from the EAS build page, Credentials -> Android keystore ->
  SHA-256 certificate fingerprint.

## 5. Enrol the first phone (acceptance)
Portal -> Customers -> enrolment QR -> scan with the new phone -> follow the
wizard (Device Owner activation + accessibility consent in front of the
customer) -> hide app -> test lock/unlock/payment/reminders end to end.
