-- 144 — GSC query snapshots.
--
-- The Insights search-queries read is live-only (it hits Search Console for the
-- trailing 28 days on every request and stores nothing). That's fine for "what
-- are people searching right now", but it can't answer "is this query slipping"
-- or "did the post we published move the needle" — both need history.
--
-- This table is the history. A weekly cron (api/_routes/cron/gsc-snapshot.js)
-- writes one row per query per workspace per run. Decay detection (week-over-week
-- position delta), cannibalization, and the post-publish ranking-delta loop all
-- read from here. History only accrues from the first cron run forward — it
-- cannot be backfilled — so the table lands ahead of the UI that consumes it.

CREATE TABLE IF NOT EXISTS public.gsc_query_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  query        text NOT NULL,
  clicks       integer          NOT NULL DEFAULT 0,
  impressions  integer          NOT NULL DEFAULT 0,
  ctr          double precision NOT NULL DEFAULT 0,
  position     double precision NOT NULL DEFAULT 0,
  window_days  integer          NOT NULL DEFAULT 28,
  captured_at  timestamptz      NOT NULL DEFAULT now()
);

-- Primary read pattern: latest snapshot(s) for a (workspace, query) ordered by time.
CREATE INDEX IF NOT EXISTS gsc_query_snapshots_ws_query_time
  ON public.gsc_query_snapshots (workspace_id, query, captured_at DESC);

-- Secondary: "all queries captured in a given run" for a workspace.
CREATE INDEX IF NOT EXISTS gsc_query_snapshots_ws_time
  ON public.gsc_query_snapshots (workspace_id, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gsc_query_snapshots TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
