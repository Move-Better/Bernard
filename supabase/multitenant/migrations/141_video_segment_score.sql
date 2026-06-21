-- 141_video_segment_score.sql
-- Moment Miner redesign: rank proposed video_segments by a quotability score and
-- classify each by moment type, so the moment-first feed can sort "strongest
-- first" and chip-filter by kind. Both are written by the detector LLM pass for
-- new segments and backfilled lazily on first feed load for existing ones.
--   score       — 0..100 quotability/post-worthiness (null = not yet scored)
--   moment_type — coaching_cue | patient_breakthrough | hook | credibility |
--                 insight | technique | story (free text; scorer picks from the set)

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS score       smallint,
  ADD COLUMN IF NOT EXISTS moment_type text;

-- Table-level grants already cover new columns (003_grant_service_role), but
-- re-assert for self-sufficiency per the migration convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
