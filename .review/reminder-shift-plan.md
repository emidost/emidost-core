# Reminder control shift (lead decision, 2026-10-03)

User rule: BEFORE the due day, the phone sends reminders ONLY when the
retailer triggers them — online (app command) or offline (SMS from the
retailer's registered number). The due-day (10:00/14:00/20:00) and overdue
escalation (30-min voice, day-3 location SMS, 4-day offline lock) stay
automatic as previously specced.

Decisions:
1. Automatic pre-due AND post-due scheduled reminders are removed
   (−3/−1/+1/+3 days) — the due-day 3x + overdue escalation replace the
   post-due part; the pre-due part becomes retailer-driven.
2. New REMIND command (online + SMS): friendly bn/hi payment-reminder voice +
   notification, distinct from the urgent ALERT voice.
3. SMS command set (all from the retailer's registered number, customer code
   gated; LOCK needs DO + outstanding + lock plan; UNLOCK needs the 8-digit
   TOTP):
   - LOCK <code>
   - UNLOCK <code> <totp>
   - REMIND <code> — friendly reminder voice + notification
   - ALERT <code> — urgent overdue voice + notification
   - LOCATION <code> — phone replies by SMS with its Google Maps link
4. Retailer-triggered REMIND/ALERT/LOCATION work even when the escalation
   kill-switch is off (a deliberate retailer action beats the anti-harassment
   toggle; the AUTOMATIC escalation keeps respecting it). Documented.
5. Online equivalents: commands route accepts REMIND (like ALERT, no
   allowance, settled loans refused); retailer app device quick actions gain
   "Remind" beside "Alert".

Scopes: claude = supabase 0016 + commands route + docs (CONTEXT/SETUP/checklist/
FUNCTION_REPORT/checksum). codex = shared types + copy + SMS receiver + native
service + JS dispatch + retailer app buttons + reminder-schedule removal.
