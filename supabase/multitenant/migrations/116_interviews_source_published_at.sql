-- Add source_published_at to interviews so the URL import lane can
-- preserve the original blog publish date through to content_items.
--
-- Populated by api/import-url.js when Jina.ai returns a Published Time
-- metadata header. Used in api/db/interviews.js completion handler so
-- the blog content_item.published_at reflects when the original post
-- was published, not when it was imported into NarrateRx.

ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz;

COMMENT ON COLUMN interviews.source_published_at IS
  'Original publish date of the imported source (from Jina.ai Published Time header). '
  'Set by the URL import lane; used to backdate content_items.published_at on completion.';
