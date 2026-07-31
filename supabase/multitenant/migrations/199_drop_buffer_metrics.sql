-- 199 — drop the Buffer-era per-post metrics cache.
--
-- content_items.buffer_metrics / buffer_metrics_fetched_at were written and
-- read by exactly one endpoint, /api/buffer-analytics, and by nothing else.
-- Every aggregate surface had already moved to engagement_snapshots
-- (top-performers, topic-suggestions, social-by-week, workspace-week); this
-- change moves the last per-post reader across too.
--
-- No data is lost that anyone could use: all 18 rows carrying a value held an
-- entirely zero metrics object. bundle.social's CACHED analytics endpoint
-- returns zeros and only a `force: true` pull returns real figures — the daily
-- refresh-engagement cron forces, the read that populated this column did not.
-- The same posts have real numbers in engagement_snapshots (verified in prod
-- 2026-07-30: a Facebook post reading 0/0/0 here had views 5, likes 1, reach 4
-- in its snapshot), so dropping the column strictly improves what the UI shows.
--
-- Grants: none needed — dropping columns from an existing table leaves
-- content_items' service_role grants untouched.

ALTER TABLE public.content_items DROP COLUMN IF EXISTS buffer_metrics;
ALTER TABLE public.content_items DROP COLUMN IF EXISTS buffer_metrics_fetched_at;
