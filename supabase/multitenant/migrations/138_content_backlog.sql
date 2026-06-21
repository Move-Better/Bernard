-- Migration 138: content backlog ("held") foundation for F2 (the autonomous teammate).
--
-- F2's Strategist composes a weekly plan filled to cadence_policy targets and
-- BANKS the surplus as an explicit backlog the scheduler later pulls from to
-- fill thin weeks (the "you have N banked" rail + "this call carries you ~3
-- weeks"). See .claude/f1-f2-cadence-spec.md (F2.3, decision: explicit held).
--
-- Modeling choice: "held" is its OWN nullable timestamp, not a `status` value.
--   * It is orthogonal to the approval lifecycle — a banked piece is typically
--     already approved, so a status='held' would erase that approval state.
--   * It is orthogonal to scheduling — content_items.scheduled_at already exists
--     and serves the slot time, so no separate `scheduled_for` is added.
--   * content_items.status is free text with NO check constraint today, so there
--     is nothing to extend anyway.
--
--   held_at IS NULL      -> live (in the normal plan / review / schedule flow)
--   held_at IS NOT NULL  -> banked backlog; the value is WHEN it was banked,
--                           giving the scheduler a FIFO pull order.
--
-- The scheduler promotes a backlog item by clearing held_at and setting
-- scheduled_at (+ status) when it lands the piece in a real slot.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS held_at timestamptz;

COMMENT ON COLUMN public.content_items.held_at IS
  'F2 backlog: timestamp this piece was banked/held for a later week. NULL = live. The scheduler clears it and sets scheduled_at when promoting it into a slot.';

-- Backlog reads are always workspace-scoped and filter held_at IS NOT NULL
-- (the banked-count rail + the scheduler''s pull query). A partial index keeps
-- it tiny — only banked rows are indexed — and orders by held_at for FIFO pull.
CREATE INDEX IF NOT EXISTS content_items_backlog_idx
  ON public.content_items (workspace_id, held_at)
  WHERE held_at IS NOT NULL;

-- No GRANT needed: content_items is an existing table already granted to
-- service_role (see 003_grant_service_role.sql); a new column + index inherit
-- the table''s existing privileges.
