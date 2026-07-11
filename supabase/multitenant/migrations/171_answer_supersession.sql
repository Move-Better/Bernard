-- 171_answer_supersession.sql
-- F16 Phase 3 — supersession-maintained public answer corpus.
--
-- When a clinician CONFIRMS a supersession in the practice brain (their thinking
-- on a topic changed), Bernard sweeps their PUBLISHED public answers, semantically
-- matches the ones on that topic, re-drafts them in the now-updated voice, re-runs
-- the Phase-1 voice gate, and drops the fresh draft back into their review queue as
-- needs_review. The live movebetter.co page stays up untouched until they approve
-- (replace) or retract (take down). Retract is a new terminal status.
--
-- These columns let the review queue distinguish a re-surfaced live answer from a
-- fresh draft: review_reason='superseded' + superseded_by (the triggering
-- practice_memory_supersessions.id) + superseded_at, with movebetterco_slug still
-- set (still live). See api/_lib/sweepSupersededAnswers.js + api/_routes/answers.js.
--
-- No new object (ALTER on the existing answers table) -> answers' existing GRANT
-- (159_answers.sql) already covers service_role. Additive + idempotent.

ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS review_reason  text,          -- 'superseded' when a confirmed supersession re-surfaced this answer
  ADD COLUMN IF NOT EXISTS superseded_by  uuid,          -- practice_memory_supersessions.id that triggered the re-draft
  ADD COLUMN IF NOT EXISTS superseded_at  timestamptz;   -- when the sweep flagged it

-- Add 'retracted' to the status CHECK (a clinician took a live answer down).
ALTER TABLE public.answers DROP CONSTRAINT IF EXISTS answers_status_check;
ALTER TABLE public.answers
  ADD CONSTRAINT answers_status_check
  CHECK (status IN ('drafting','needs_review','changes_requested','approved','published','retracted'));
