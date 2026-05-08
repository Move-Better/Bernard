-- Run this in your Supabase SQL Editor
-- Supabase Dashboard → SQL Editor → New Query → paste → Run
--
-- Run on EACH brand's Supabase instance (people, equine, animals).
--
-- Adds `archived_at` to media_assets so DELETE becomes a soft-delete:
--   status = 'archived', archived_at = now(). Restorable forever via PATCH.
-- Hard delete moves behind /api/media/[id]/purge — admin-only, gated by a
-- 30-day cooldown after archived_at.

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS media_assets_archived_at_idx
  ON media_assets(archived_at)
  WHERE archived_at IS NOT NULL;
