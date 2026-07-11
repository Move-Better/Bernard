-- 168_video_segment_nomination_source.sql
-- F13 fast-follow: let the VIDEO nominate its own moments, not just re-rank the
-- transcript's picks. A visual pass scans sampled frames across the whole source
-- and proposes windows the transcript walked past (a strong demo/gesture on a
-- plain line). This column records who nominated each segment:
--   'transcript' (default) — the words picked it (today's path)
--   'visual'               — the camera picked it (frame scan found it)
--
-- 'visual' also acts as a CONFIDENCE marker for downstream automation: a
-- video-nominated moment may have a thin spoken line, so as auto-publish grows,
-- these surface in the feed but should route to review rather than auto-ship.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS nomination_source text NOT NULL DEFAULT 'transcript';

-- Table-level grants already cover new columns (003_grant_service_role), but
-- re-assert for self-sufficiency per the migration convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
