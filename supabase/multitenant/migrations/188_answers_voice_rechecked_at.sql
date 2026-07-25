-- 188 — track when a LIVE answer last had its voice re-checked.
--
-- The drift sweep re-scores published answers on a 90-day cadence and re-queues
-- the ones that have drifted from the clinician's voice. It needs its own clock:
-- updated_at moves for many unrelated reasons (an edit, a publish retry, a slug
-- change), so pacing the sweep off it would re-check some answers constantly and
-- others never.
--
-- Nullable on purpose. A null means "never swept", and the sweep falls back to
-- published_at for eligibility — so the existing library becomes eligible on its
-- own publish date rather than all at once on deploy day.

ALTER TABLE public.answers ADD COLUMN IF NOT EXISTS voice_rechecked_at timestamptz;

COMMENT ON COLUMN public.answers.voice_rechecked_at IS
  'Last time the drift sweep re-scored this live answer. Null = never swept; eligibility falls back to published_at.';

-- Partial index: the sweep only ever scans published answers that are actually live.
CREATE INDEX IF NOT EXISTS answers_live_recheck_idx
  ON public.answers (voice_rechecked_at NULLS FIRST)
  WHERE status = 'published' AND movebetterco_slug IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.answers TO service_role;
