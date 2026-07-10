-- 167_video_segment_visual_score.sql
-- F13 — Video-native moment understanding. Adds a VISUAL score for each proposed
-- video_segment, judged by a multimodal model watching the clip window (energy,
-- eye contact, gesture, framing, b-roll-worthiness) — complementary to `score`
-- (141), which rates the transcript. The Moment feed ranks on a blend of the two
-- (blendMomentScore in scoreMomentsVisual.js), computed at read time so the
-- weights/veto stay tunable without a backfill.
--   visual_score      — 0..100 on-camera quality (null = not yet visually scored)
--   visual_breakdown  — { energy, eye_contact, gesture, framing, broll_worthiness, note }
--
-- v1 scores NEW footage at detection time (segmentDetect.js). Existing segments
-- stay visual_score=null and rank on their transcript score until re-detected.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS visual_score      smallint,
  ADD COLUMN IF NOT EXISTS visual_breakdown  jsonb;

-- Table-level grants already cover new columns (003_grant_service_role), but
-- re-assert for self-sufficiency per the migration convention.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
