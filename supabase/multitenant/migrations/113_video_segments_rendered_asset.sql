-- Migration 113: video_segments → media_assets b-roll output (Option 2)
--
-- The new Slate is a clip workshop: a "clip" is a rendered media_assets row with
-- parent_asset_id set to its source video (the same shape saveSlateBroll produces
-- for the manual "Library b-roll" output). It no longer surfaces story_packages.
--
-- The AI "Find clips" path (find-clips → video_segments → render-segments) still
-- produced story_packages, so its rendered clips were invisible on the reworked
-- Slate. This migration repoints that path at the media_assets model:
--
--   • rendered_asset_id — the media_assets b-roll row a kept segment rendered into
--     (replaces the story_package_id linkage for the new flow; story_package_id is
--     left in place for historical rows but no longer written).
--   • status gains 'rendering' — the interim state while the off-request-path reel
--     render runs, before the media_asset lands. segmentDetect clears stale
--     'rendering' rows on the next detect so a hard-killed render self-heals.
--
-- Self-sufficient per CLAUDE.md: GRANTs bundled inline.

ALTER TABLE public.video_segments
  ADD COLUMN IF NOT EXISTS rendered_asset_id uuid
    REFERENCES public.media_assets(id) ON DELETE SET NULL;

-- Extend the status CHECK with 'rendering' (interim render state).
ALTER TABLE public.video_segments
  DROP CONSTRAINT IF EXISTS video_segments_status_check;
ALTER TABLE public.video_segments
  ADD CONSTRAINT video_segments_status_check
    CHECK (status IN ('proposed','kept','discarded','rendering','rendered'));

-- Required: service_role must read/write (REST API runs as service_role).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_segments TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
