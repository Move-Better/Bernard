-- 127: AI display titles for media assets (media-flow redesign Phase 2-B).
--
-- display_title is the human-readable name shown across Slate, Library, the
-- picker, and the clip editor in place of raw camera filenames (IMG_4160.mov).
-- Written by tagAsset at tag time (model-generated from what's in the asset)
-- and by scripts/backfill-display-titles.mjs for pre-existing rows; users may
-- overwrite it later if a manual rename UI ships. Filename remains untouched
-- as metadata.
--
-- media_assets already carries table-level grants for service_role (001/003),
-- and ADD COLUMN inherits them — no new GRANT needed.

ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS display_title text;
