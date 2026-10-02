# Overdue escalation plan (lead decision, 2026-10-03)

User spec parsed into concrete rules:
- Due day: 3 notifications at 10:00, 14:00, 20:00 (local). Surrounding days
  keep the existing 09:00 −3/−1/+1/+3 reminders.
- Overdue day 1 through 5: every 30 min the phone fires one notification AND
  speaks "EMI is overdue" in Bengali then Hindi, 3 times per trigger, via TTS
  (app-level media, so it plays even when the phone is muted or in DND — it is
  not a notification sound). While overdue the app maxes the media volume and
  the Device Owner adds DISALLOW_ADJUST_VOLUME so the customer cannot mute;
  both are cleared on payment/settlement. Honest limits: a hardware mute
  switch can still cut output; DND access is requested (optional) so the
  notification channel can ring in DND too.
- Portal kill-switch: customers.overdue_escalation_enabled (default true);
  owner/retailer console toggle stops the audio escalation AND the location
  SMS. Delivered via heartbeat; audited.
- Retailer trigger: new ALERT command (no allowance) plays the same bn+hi
  voice once, from the retailer app quick action.
- Overdue day 3+ (no payment update): the phone fetches its GPS once per
  window, twice a day, in windows 10:00-12:00 and 18:00-20:00 (stable random
  minute per window), and SMSes the retailer's registered number a Google Maps
  link (https://maps.google.com/?q=lat,lng). Sent by the phone itself
  (SEND_SMS already granted); documented that it uses the customer's SMS
  balance. Gated on escalation_enabled + loan outstanding. Applies to
  notify_only plans too (they never lock; alerts are their only enforcement).
- Offline + overdue 4 days (user delta): when the phone has had no server
  contact for 4 days AND the loan is overdue (cached or locally computed from
  the due date in IST), it hard-locks itself locally
  ('overdue-offline-watchdog-4d'), lock plans only; notify_only never locks.
  NOT gated on escalation_enabled (that toggle stops alerts + location SMS,
  never locks). The existing 5-day no-internet watchdog stays as the outer
  bound; the settled-while-offline edge keeps the documented TOTP SMS escape.

## Scopes

- claude: supabase migration 0015 (ALERT enum + escalation_enabled column),
  commands route accepts ALERT, PATCH escalation toggle route, console
  customer detail toggle UI, heartbeat delivers the flag, audit rows, docs
  (checklist section K, CONTEXT, SETUP, checksum, FUNCTION_REPORT rows,
  privacy + mute honesty notes).
- codex: native + JS: due-day schedule, 30-min escalation loop in the command
  service (notification channel IMPORTANCE_MAX + TTS bn+hi ×3 + media volume
  max + DISALLOW_ADJUST_VOLUME add/clear), 3-day location SMS windows +
  maps link, ALERT dispatch + retailer app button, shared types, copy.ts bn/hi
  overdue voice lines, TTS setup (expo-speech).
- lead: verify, commit, push.
