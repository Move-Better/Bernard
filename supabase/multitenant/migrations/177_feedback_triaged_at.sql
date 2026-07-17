-- 177_feedback_triaged_at.sql
--
-- Adds triage state to the `feedback` table so the /triage-feedback loop (and any
-- scheduled routine) can tell which submissions are new vs. already investigated.
-- DB-native state (not a local file) so a headless cloud routine and an interactive
-- session share one source of truth for "what's been triaged."
--
--   triaged_at   — timestamptz, set when a triage pass has investigated the row.
--   triage_note  — optional short human/agent note (e.g. "spawned task chip", "dupe of #2170").
--
-- No CHECK constraints; both columns are nullable and default NULL (= untriaged).

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS triaged_at  timestamptz,
  ADD COLUMN IF NOT EXISTS triage_note text;

-- Partial index so "give me the untriaged queue" stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS feedback_untriaged_idx
  ON public.feedback (created_at)
  WHERE triaged_at IS NULL;

-- feedback already grants to service_role from its own migration; re-assert for safety.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO service_role;
