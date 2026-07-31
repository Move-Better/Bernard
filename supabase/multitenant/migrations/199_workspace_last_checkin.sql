-- 199_workspace_last_checkin.sql — when the owner last did a check-in.
--
-- The check-in becomes a CHECKPOINT rather than a permanent card (Q, 2026-07-30:
-- ProducerHome is "what do I need to do", not a data surface). A checkpoint has
-- to know when it is DUE, and due-ness needs a last-done timestamp — so this
-- column is what makes the whole move possible.
--
-- It also closes a deferral that was hiding a real gap: the digest endpoint
-- (#2489) compares a fixed 30-day window against the preceding one, with a
-- comment saying a stored last-check-in timestamp "would be better" but was
-- deferred. It wasn't better — it was required, and the fixed window was
-- standing in for it.
--
-- NULL means never checked in. A workspace that has published enough to be
-- worth reviewing then shows the checkpoint immediately, rather than waiting an
-- arbitrary interval from a date nobody set.
--
-- No GRANT needed: service_role already holds table-level privileges on
-- public.workspaces, and a column add inherits them.

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS last_checkin_at timestamptz;

COMMENT ON COLUMN public.workspaces.last_checkin_at IS
  'When the owner last completed a learning check-in. NULL = never. Drives the check-in checkpoint on ProducerHome (see api/_routes/producer/checkpoints.js).';
