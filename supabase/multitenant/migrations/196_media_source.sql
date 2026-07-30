-- 196_media_source.sql — who chose the media currently on a content item.
--
-- The third override dimension for the confidence loop. Words already have
-- content_items.edit_diff and format has format_source (migration 195); a photo
-- swap left NO trace at all, because media_urls is overwritten in place and
-- edit_diff is text-only. Without this the learning panel has a permanent hole.
--
-- 'bernard' — auto-attach picked this media (api/_lib/autoAttachMedia.js).
-- 'human'   — a person REPLACED an existing non-empty selection.
--
-- The distinction is drawn STRUCTURALLY, server-side, never from a client
-- claim: the editor's own auto-attach-on-open and a human's swap arrive through
-- the same PATCH from the same client, so a caller-supplied flag would be
-- unreliable in both directions. An attach onto EMPTY media is not an override
-- (nobody's choice was overridden); replacing existing media is.
--
-- No GRANT needed: content_items already grants service_role.

ALTER TABLE public.content_items ADD COLUMN IF NOT EXISTS media_source text;

DO $$ BEGIN
  ALTER TABLE public.content_items ADD CONSTRAINT content_items_media_source_check
    CHECK (media_source IS NULL OR media_source = ANY (ARRAY['bernard','human']));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.content_items.media_source IS
  'Who chose the current media: bernard (auto-attach) or human (replaced an existing selection). NULL = unknown/never set. Server-stamped only.';
