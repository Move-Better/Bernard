-- N1: server-side draft sync for the video editor.
-- The editor operates on a media_asset (no content_item exists until export),
-- so the in-progress edit doc (grade/reframe/overlays/speed/caption/trim) is
-- persisted on the asset itself. This replaces the per-browser localStorage
-- draft so edits follow the user across devices and survive a cache clear.
-- Distinct from content_items.video_edit (137), which holds the FINAL reel-edit
-- doc once a clip is exported to a post.
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS video_edit_draft jsonb;

-- No new GRANT needed: column inherits the table's existing service_role grants.
