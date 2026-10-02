-- emidost 0016 - REMIND command type (reminder control shift).
-- Automatic pre-due AND post-due scheduled reminders (−3/−1/+1/+3) are
-- removed: the due-day 3x and the overdue escalation stay automatic, and
-- everything before the due day is RETAILER-TRIGGERED — the online REMIND
-- command (friendly bn/hi payment-reminder voice + notification) or the
-- offline SMS REMIND <code>. REMIND consumes NO allowance and is refused on
-- settled loans, exactly like ALERT. Retailer-triggered REMIND/ALERT/LOCATION
-- work even when the escalation kill-switch is off (a deliberate retailer
-- action beats the anti-harassment toggle; automatic escalation still
-- respects it).
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run (or use
-- 0000_all_in_one.sql which includes this).

alter type public.command_type add value if not exists 'REMIND';
