-- 137_video_editor_doc.sql
-- Reel / short-form video editor (v1) data model.
--
-- The video editor is "the photo editor + a time axis": a clip gets a grade
-- (same canonical schema as the photo colorist), a static reframe, manual timed
-- text overlays, and an editable caption track. These persist as ONE jsonb doc
-- on the content_items piece (mirrors how `slides` holds the carousel doc), so
-- the editor Save and the publish / ad-export bake read identical params
-- (preview == publish — the #1 video risk class, CLAUDE.md).
--
--   content_items.video_edit = {
--     clip:         { startSec, durationSec },
--     reframe:      { zoom, x, y },          -- static 9:16 crop (zoom 100-220, x/y 0-100)
--     grade:        { exposure, contrast, saturation, warmth, tint, depth },  -- canonical gradeParams
--     speed:        number,                  -- 0.5 | 1 | 1.5 | 2
--     overlays:     [ { id, role, text, x, y, size, anim, "in", out, color } ],
--     captionTrack: { source, style:{preset,accent,position,size,font},
--                     lines:[ { start, end, text, words:[[word,start,end]] } ] }
--   }
--
-- Caption persistence (V1): the FULL source Whisper word-timestamps are stored
-- ONCE on the source asset so any clip window slices them without re-transcribing
-- (stop discarding the words after each render).
--
--   media_assets.transcript_words = [ { word, start, end } ]   -- whole-source ASR words
--
-- No new GRANT needed: adding a column to a table that already has a table-level
-- GRANT to service_role inherits the privilege (Postgres applies table grants to
-- columns added later). content_items + media_assets were granted in 001/003.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS video_edit jsonb;

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS transcript_words jsonb;

COMMENT ON COLUMN public.content_items.video_edit IS
  'Reel/short-form editor doc {clip,reframe,grade,speed,overlays,captionTrack}. One render path (preview==publish). Migration 137.';
COMMENT ON COLUMN public.media_assets.transcript_words IS
  'Whole-source Whisper word-timestamps [{word,start,end}] persisted once so clip windows slice without re-transcribing. Migration 137.';
