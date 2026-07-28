-- 192_moment_bank_planning.sql
-- Moment-bank sprint P3 (.claude/moment-bank-sprint.md): the planner composes
-- atoms on demand from banked exemplar moments.
--
-- Three additive pieces:
--   1. content_plan_atoms.moment_id — a bank-composed atom anchors to exactly
--      ONE moment (locked one-source-anchor decision). ON DELETE SET NULL: a
--      retired/deleted moment must not destroy an already-planned slot; the
--      atom degrades to the legacy full-transcript draft path. The presence of
--      moment_id is also what routes draftAtom/regenerate to the tight
--      verbatim-window generation + fidelity reference.
--   2. workspaces.moment_bank_planning_enabled — per-tenant cutover flag
--      (same pattern as realtime_voice_enabled / video_pipeline_enabled).
--      Default false: the planner change alters what a workspace actually
--      publishes, so it ships dark and is enabled per workspace after Q
--      eyeballs a full planned week on movebetter.
--   3. topic_backlog source 'bank_gap' — campaign planning that finds ZERO
--      bank coverage for a campaign topic queues it as an interview topic so
--      the next capture gets primed (the F16 answer_gap loop, generalized —
--      this is the knee-seminar fix). Distinct source so the demand-pull
--      flywheel is measurable.

ALTER TABLE public.content_plan_atoms
  ADD COLUMN IF NOT EXISTS moment_id uuid REFERENCES public.moments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS content_plan_atoms_moment_idx
  ON public.content_plan_atoms (moment_id);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS moment_bank_planning_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.topic_backlog DROP CONSTRAINT IF EXISTS topic_backlog_source_check;
ALTER TABLE public.topic_backlog ADD CONSTRAINT topic_backlog_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'vigil_signal'::text, 'answer_gap'::text, 'bank_gap'::text]));

-- Existing tables, but grants restated per the self-sufficient-migration rule.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plan_atoms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_backlog TO service_role;
