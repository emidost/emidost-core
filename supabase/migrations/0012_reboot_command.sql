-- emidost 0012 - REBOOT command type (owner-only recovery affordance).
-- The device refuses REBOOT while locked (native rebootDevice guard, D4);
-- the owner board queues it for unlocked/stuck phones. Retailer routes never
-- accept REBOOT, so it cannot consume lock allowances or bypass the DO gate.
-- Idempotent: ADD VALUE IF NOT EXISTS is safe to re-run (or use
-- 0000_all_in_one.sql which includes this).

alter type public.command_type add value if not exists 'REBOOT';
