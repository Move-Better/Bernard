-- 202 — why a clip was denied.
--
-- The sibling of moments.retire_reasons (migration 200), for the other half of
-- the review surface: a moment is a QUOTE, a video_segment is a CLIP, and the
-- two fail in different ways. A clip can be fine as a quote and still unusable
-- because the audio is bad or the speaker walked out of frame, which the moment
-- vocabulary has no word for. See src/lib/clipDiscard.js for the reason set;
-- keys are validated server-side against that same list.
--
-- Same shape as 200 on purpose (plain text[] + a note, no enum, no FK): the
-- vocabulary is expected to grow as we learn what people actually reject, and a
-- text[] grows without a migration.
--
-- Why this matters more than it looks: discarding already EXISTED
-- (video_segments.status='discarded') but was a text link buried in the editor's
-- Moments side panel, and across 172 segments it had been used exactly once.
-- Capturing the reason is only worth anything once the action is findable, so
-- this migration ships with the header Deny button, not before it.
--
-- Capture-only for now, exactly like retire_reasons: nothing reads these to
-- change behaviour yet. Wiring them into detection/ranking is a later decision
-- that needs real volume first.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS discard_reasons text[],
  ADD COLUMN IF NOT EXISTS discard_note    text;

-- No grants needed: adding columns to an existing table leaves video_segments'
-- service_role grants untouched.
