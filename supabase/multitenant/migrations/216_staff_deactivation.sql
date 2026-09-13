-- 216_staff_deactivation.sql
--
-- Switch a team member's Bernard access off without deleting anything.
--
-- Q, 2026-09-13: Philip left Move Better but may return for part-time contract
-- work, so his Clerk login must survive. Removing him from the Clerk org or
-- deleting / merging his staff row would also rewrite his history (433
-- uploads, 79 approvals) under someone else's name.
--
-- deactivated_at is null for an active person. When set, requireRole
-- (api/_lib/auth.js) refuses every request from that user in this workspace
-- with reason 'deactivated', and recipient lists for nudges and digests skip
-- them. permission_tier, capability_overrides and every stamp are untouched,
-- so reactivating (clearing the column) restores exactly what they had.
--
-- Mirrors Deep Thought's staff_profiles.deactivated_at (#1074) so both apps
-- treat a departure the same way.
--
-- Existing table: no new grants needed.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by text;

COMMENT ON COLUMN public.staff.deactivated_at IS 'Set = access switched off; Clerk login, tier and history kept. Reactivate clears it.';
COMMENT ON COLUMN public.staff.deactivated_by IS 'Clerk user id of the owner who deactivated.';
