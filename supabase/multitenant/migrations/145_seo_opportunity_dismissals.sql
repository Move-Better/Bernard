-- 145 — SEO opportunity dismissals.
--
-- The SEO Opportunities feed (/seo) lets an editor dismiss a content opportunity
-- they've decided not to act on (e.g. a query that belongs to a different
-- workspace, or one they've intentionally skipped). Dismissals are per-query,
-- per-workspace, and persistent so a dismissed card doesn't reappear on reload.
--
-- Keyed by the raw query string (queries are the stable identity here — the
-- opportunity engine is recomputed live from GSC each load, so there is no
-- durable opportunity id to reference). UNIQUE(workspace_id, query) makes the
-- dismiss endpoint a safe upsert.

CREATE TABLE IF NOT EXISTS public.seo_opportunity_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  query        text NOT NULL,
  dismissed_by text,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, query)
);

CREATE INDEX IF NOT EXISTS seo_opportunity_dismissals_ws
  ON public.seo_opportunity_dismissals (workspace_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_opportunity_dismissals TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
