-- 148_platform_usage_fn.sql
-- Cross-tenant aggregation powering the super-admin /admin page — every
-- workspace's adoption at a glance. The ONE function that deliberately reads
-- across all workspaces (no ws_id scope); its API route is gated by the
-- user-level requirePlatformAdmin() flag, which is the authorization boundary.
--
-- Returns:
--   • topline    — total workspaces, active-this-week count, captures &
--                  published this week (summed), and at-risk/idle count
--                  (no activity in 14d).
--   • workspaces — per workspace: id/slug/display_name/plan/status,
--                  last_active_at, active_days_28d, captures_week,
--                  published_week, an activity_status classification
--                  (active <7d · at-risk 7–14d · idle ≥14d or never), and an
--                  8-week published trend sparkline. Sorted by 28-day active
--                  days desc.
--
-- All from existing timestamps (no new tracking). Read-only; SECURITY DEFINER.
-- Idempotent (CREATE OR REPLACE) — running this IS the apply.

CREATE OR REPLACE FUNCTION public.platform_usage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  acts AS (
    SELECT i.workspace_id AS ws, i.created_at AS at, 'capture'::text AS kind FROM interviews i
    UNION ALL
    SELECT c.workspace_id, c.created_at, 'draft' FROM content_items c
    UNION ALL
    SELECT c.workspace_id, c.published_at, 'publish' FROM content_items c WHERE c.status='published' AND c.published_at IS NOT NULL
    UNION ALL
    SELECT m.workspace_id, m.created_at, 'media' FROM media_assets m
  ),
  ws_rows AS (
    SELECT w.id, w.slug, w.display_name, w.plan, w.status,
      (SELECT max(a.at) FROM acts a WHERE a.ws = w.id) AS last_active_at,
      (SELECT count(DISTINCT (a.at AT TIME ZONE 'UTC')::date) FROM acts a WHERE a.ws=w.id AND a.at >= now()-interval '28 days') AS active_days_28d,
      (SELECT count(*) FROM acts a WHERE a.ws=w.id AND a.kind='capture' AND a.at >= now()-interval '7 days') AS captures_week,
      (SELECT count(*) FROM acts a WHERE a.ws=w.id AND a.kind='publish' AND a.at >= now()-interval '7 days') AS published_week,
      (SELECT coalesce(jsonb_agg(
          (SELECT count(*) FROM acts a WHERE a.ws=w.id AND a.kind='publish' AND date_trunc('week',a.at)::date = wk) ORDER BY wk), '[]'::jsonb)
        FROM generate_series(date_trunc('week', now())::date - (7 * interval '1 week'), date_trunc('week', now())::date, interval '1 week') wk) AS trend
    FROM workspaces w
  ),
  classified AS (
    SELECT r.*,
      CASE
        WHEN r.last_active_at IS NULL OR r.last_active_at < now()-interval '14 days' THEN 'idle'
        WHEN r.last_active_at < now()-interval '7 days' THEN 'at-risk'
        ELSE 'active'
      END AS activity_status
    FROM ws_rows r
  )
  SELECT jsonb_build_object(
    'topline', jsonb_build_object(
      'workspaces', (SELECT count(*) FROM classified),
      'active_this_week', (SELECT count(*) FROM classified WHERE activity_status='active'),
      'captures_week', (SELECT coalesce(sum(captures_week),0) FROM classified),
      'published_week', (SELECT coalesce(sum(published_week),0) FROM classified),
      'at_risk', (SELECT count(*) FROM classified WHERE activity_status IN ('at-risk','idle'))
    ),
    'workspaces', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'slug', slug, 'display_name', display_name, 'plan', plan, 'status', status,
        'last_active_at', last_active_at, 'active_days_28d', active_days_28d,
        'captures_week', captures_week, 'published_week', published_week,
        'activity_status', activity_status, 'trend', trend
      ) ORDER BY active_days_28d DESC, last_active_at DESC NULLS LAST), '[]'::jsonb) FROM classified)
  );
$$;

GRANT EXECUTE ON FUNCTION public.platform_usage() TO service_role;
