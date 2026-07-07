-- 161 — GSC snapshot: per-URL rows for cannibalization (P3).
--
-- The weekly gsc-snapshot cron has written one QUERY-LEVEL row per query
-- (page = NULL) since 144. Decay and post-publish ranking-delta read those
-- rows and are unaffected by this change.
--
-- Cannibalization — two of your own pages competing for one query — needs to
-- know WHICH URLs rank for each query, which the query-level rows can't tell.
-- This adds an optional `page` column so the cron can ALSO write per-(query,
-- page) rows (page = ranking URL). Query-level rows keep page = NULL; page-level
-- rows carry the URL. Like all snapshot history it can't be backfilled, so the
-- column lands ahead of the cannibalization UI (which stays locked until ~2
-- weeks of page-level rows accrue).
ALTER TABLE public.gsc_query_snapshots ADD COLUMN IF NOT EXISTS page text;

-- Read pattern for cannibalization: latest per (workspace, query, page).
CREATE INDEX IF NOT EXISTS gsc_query_snapshots_ws_query_page_time
  ON public.gsc_query_snapshots (workspace_id, query, page, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_snapshots TO service_role;
