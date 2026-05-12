-- Tier 3 of the exemplar feedback loop: wire GA4 as a second engagement source
-- alongside Buffer. Buffer covers social distribution; GA4 covers website-
-- published blog posts (WordPress for equine, Astro+GitHub for animals + people)
-- which have content_items.status='published' but no buffer_update_id and were
-- previously invisible to the daily refresh-engagement cron.
--
-- Two columns and one credential service convention:
--
--   1. content_items.resolved_url — the public URL after a successful website
--      publish. Captured from the publish endpoint's postUrl response and
--      stored on the platform='blog' content_item. The cron uses this as the
--      pagePath filter when calling GA4.
--
--   2. workspaces.ga4_property_id — the numeric GA4 property ID (e.g.
--      "337244920"). Non-sensitive (just an identifier; access is gated by the
--      service-account secret), so it lives on the workspace row rather than
--      in workspace_credentials.config.
--
--   3. workspace_credentials.service='ga4' — secret_ciphertext holds the full
--      service-account JSON key file (as a string). config is unused for now.
--      The service account must be granted Viewer on the GA4 property.
--
-- Why a separate column rather than reusing platform_post_id: platform_post_id
-- is set by Buffer for social platforms and would conflate two different
-- identifier shapes (Buffer update id vs. canonical URL). resolved_url makes
-- the distinction explicit and leaves room for future per-platform permalinks
-- (IG, FB) without overloading semantics.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS resolved_url text;

-- Partial index — the cron walks (workspace_id, platform='blog', status='published',
-- resolved_url IS NOT NULL) once a day. Skip the bloat from the millions of
-- social rows that will never have a URL.
CREATE INDEX IF NOT EXISTS content_items_resolved_url_idx
  ON public.content_items (workspace_id, platform, published_at DESC)
  WHERE resolved_url IS NOT NULL;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ga4_property_id text;

-- No new tables — engagement_snapshots already accepts source='ga4' (the
-- column is plain text per migration 021) and stats is a flexible jsonb blob.
-- GA4 rows will write stats = { pageviews, engaged_sessions, engagement_time }
-- shape, distinct from Buffer's { statistics, status, sent_at, ... }.

-- Existing tables retain their grants from prior migrations. New columns
-- inherit table-level grants automatically, so no GRANT block is required
-- here (verified against the grant pattern documented in CLAUDE.md — that
-- rule applies to NEW tables/views/sequences/functions, not added columns).
