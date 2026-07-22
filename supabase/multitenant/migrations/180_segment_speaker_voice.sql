-- 180_segment_speaker_voice.sql
--
-- Who is actually TALKING in a moment — clinician or patient.
--
-- Nothing in the schema could answer this. `media_assets.speaker_role` looks
-- like it should, but it is the ASSET's nominal role and it is wrong often
-- enough to be unusable as a gate: on movebetter, `Melanie Final Cut.mp4` is a
-- patient testimonial (Lyme disease, wheelchair) stored as
-- speaker_role='clinician', asset_purpose='interview'. Six of that workspace's
-- top-eleven scored moments are patient-voice and every one sits on an asset
-- labelled 'clinician'.
--
-- The label must be per-MOMENT, not per-asset, because one interview file
-- genuinely contains both people — the clinician asks, the patient answers, and
-- the miner cuts standalone windows from either. No amount of care filling in an
-- asset-level column can represent that.
--
--   speaker_voice             clinician | patient | mixed | unknown
--                             NULL = not yet classified (pre-migration rows).
--   speaker_voice_confidence  0..1 from the classifier.
--
-- No CHECK constraint on the vocabulary, matching 178/179: a CHECK here forces a
-- migration lock-stepped with every code change that adds a value. NULL is
-- meaningfully different from 'unknown' — NULL means never looked at, 'unknown'
-- means looked at and could not tell.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS speaker_voice            text,
  ADD COLUMN IF NOT EXISTS speaker_voice_confidence real;

COMMENT ON COLUMN public.video_segments.speaker_voice IS
  'Who speaks in THIS moment: clinician | patient | mixed | unknown. NULL = unclassified. Per-moment because one interview file contains both; media_assets.speaker_role is per-asset and unreliable.';
COMMENT ON COLUMN public.video_segments.speaker_voice_confidence IS
  '0..1 classifier confidence for speaker_voice.';

-- The reel worker''s selection query filters on voice within a workspace.
CREATE INDEX IF NOT EXISTS video_segments_ws_voice_idx
  ON public.video_segments (workspace_id, speaker_voice);

-- Backfill queue: find unclassified segments cheaply.
CREATE INDEX IF NOT EXISTS video_segments_unclassified_idx
  ON public.video_segments (workspace_id)
  WHERE speaker_voice IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
