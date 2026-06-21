-- Migration 139: weekly-plan state on content_plan_atoms (F2 Strategist substrate).
--
-- F2.1 decision (Q 2026-06-21): the Strategist REPLACES the per-interview grid
-- (api/_lib/atomPlan.js buildPlanRows) and composes a PRACTICE-WEEK plan as
-- content_plan_atoms rows, with text drafted ON DEMAND (atoms stay 'pending'
-- until a piece is opened/approved). See .claude/f1-f2-cadence-spec.md (F2.1).
--
-- Because drafting is deferred, a planned slot AND its banked surplus are both
-- undrafted ATOMS — so the plan/backlog state lives here, on the slot layer.
-- (content_items.held_at from migration 138 stays as the twin for the rarer
-- case of a fully-drafted piece a human banks; the F2.3 "N banked" count reads
-- primarily from atom-level held_at.)
--
-- New columns (all nullable; legacy grid atoms simply have them NULL):
--   plan_week   date         -- Monday of the week this atom is planned into.
--                               The Strategist's idempotency key + the "show me
--                               the week" grouping. NULL = not week-planned.
--   scheduled_at timestamptz -- target publish slot for a THIS-WEEK atom.
--   held_at      timestamptz -- banked surplus (when it was banked; FIFO pull).
--                               held_at set + scheduled_at NULL = backlog.
--   brief        text        -- the Strategist's CONCRETE topic/instruction for
--                               the drafter (the specific subject drawn from the
--                               week's interviews); angle_label/angle stay the
--                               palette TYPE. NULL = use the generic angle.
--   planned_by   text        -- 'strategist' | 'grid'. Provenance so the weekly
--                               cron only recomposes its OWN untouched atoms and
--                               never clobbers legacy grid atoms or human edits.

ALTER TABLE public.content_plan_atoms
  ADD COLUMN IF NOT EXISTS plan_week    date,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_at      timestamptz,
  ADD COLUMN IF NOT EXISTS brief        text,
  ADD COLUMN IF NOT EXISTS planned_by   text;

COMMENT ON COLUMN public.content_plan_atoms.plan_week IS
  'F2 Strategist: Monday of the week this atom is planned into. Idempotency key + week grouping. NULL = not week-planned (legacy grid atom).';
COMMENT ON COLUMN public.content_plan_atoms.held_at IS
  'F2 Strategist: timestamp this slot was banked as backlog surplus (FIFO pull order). NULL = not banked. held_at set + scheduled_at NULL = backlog.';
COMMENT ON COLUMN public.content_plan_atoms.brief IS
  'F2 Strategist: concrete topic/instruction for the on-demand drafter, drawn from the week''s interviews. NULL = use the generic palette angle.';
COMMENT ON COLUMN public.content_plan_atoms.planned_by IS
  'F2 Strategist: ''strategist'' (composed by the weekly planner) or ''grid'' (legacy buildPlanRows). Lets the cron recompose only its own untouched atoms.';

-- The weekly-plan read: atoms for a workspace + week (the proposed-week surface).
CREATE INDEX IF NOT EXISTS content_plan_atoms_plan_week_idx
  ON public.content_plan_atoms (workspace_id, plan_week)
  WHERE plan_week IS NOT NULL;

-- The backlog read + scheduler pull: banked surplus, FIFO.
CREATE INDEX IF NOT EXISTS content_plan_atoms_backlog_idx
  ON public.content_plan_atoms (workspace_id, held_at)
  WHERE held_at IS NOT NULL;

-- No GRANT needed: content_plan_atoms is an existing table already granted to
-- service_role; new columns + indexes inherit the table''s privileges.
