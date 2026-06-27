-- 149_workspace_usage_week_offset.sql
-- Add week navigation to workspace_usage() (migration 147): a `week_offset`
-- parameter (0 = current calendar week, 1 = last week, …) so the /usage
-- dashboard can step backward/forward week-by-week — used to read off each
-- week's numbers for the weekly staff meeting.
--
-- Windows are now anchored to the SELECTED calendar week (Mon-start) instead
-- of a rolling 7-day window from now():
--   • sel_start = Monday of (this week − week_offset)
--   • stats this_week  = [sel_start, sel_start+7d) ; prev_week = the week before
--   • activity/stickiness/funnel = the n_weeks ENDING at the selected week
--   • staff captures_wk / published_wk = the selected week (renamed from *_4wk)
--   • all activity is filtered to `at < sel_end` so a past-week view never
--     counts future activity ("as of" the end of that week)
-- Adds a `period` block to the payload: { week_start, week_end, offset }.
--
-- The 2-arg signature workspace_usage(uuid, int) is retained as a thin shim
-- that delegates to (uuid, int, 0) so any in-flight caller keeps resolving
-- during the deploy window. Idempotent (CREATE OR REPLACE) — running this IS
-- the apply.

CREATE OR REPLACE FUNCTION public.workspace_usage(ws_id uuid, n_weeks int DEFAULT 12, week_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  bounds AS (
    SELECT
      (date_trunc('week', now())::date - (week_offset * interval '1 week'))::date AS sel_start,
      (date_trunc('week', now())::date - (week_offset * interval '1 week') + interval '7 days')::date AS sel_end
  ),
  acts AS (
    SELECT i.created_at AS at, 'capture'::text AS kind, i.staff_id FROM interviews i WHERE i.workspace_id = ws_id
    UNION ALL
    SELECT c.created_at, 'draft', c.staff_id FROM content_items c WHERE c.workspace_id = ws_id
    UNION ALL
    SELECT c.published_at, 'publish', c.staff_id FROM content_items c
      WHERE c.workspace_id = ws_id AND c.status = 'published' AND c.published_at IS NOT NULL
    UNION ALL
    SELECT m.created_at, 'media', m.staff_id FROM media_assets m WHERE m.workspace_id = ws_id
  ),
  acts_clean AS (
    SELECT a.at, a.kind, a.staff_id, (a.at AT TIME ZONE 'UTC')::date AS d
    FROM acts a, bounds b
    WHERE a.at IS NOT NULL
      AND a.at < b.sel_end
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = a.staff_id
                        AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))
  ),
  real_staff AS (
    SELECT s.id, s.name FROM staff s
    WHERE s.workspace_id = ws_id AND s.name NOT ILIKE '%e2e%' AND s.name NOT ILIKE '%smoke%'
  ),
  weeks AS (
    SELECT gs::date AS wk
    FROM bounds b, generate_series(
      b.sel_start - ((n_weeks - 1) * interval '1 week'),
      b.sel_start::timestamp,
      interval '1 week') gs
  ),
  weeks26 AS (
    SELECT gs::date AS wk
    FROM bounds b, generate_series(
      b.sel_start - (25 * interval '1 week'),
      b.sel_start::timestamp,
      interval '1 week') gs
  ),
  wk_active AS (
    SELECT w.wk,
      EXISTS (SELECT 1 FROM acts_clean a WHERE date_trunc('week', a.at)::date = w.wk) AS active
    FROM weeks26 w
  ),
  islands AS (
    SELECT wk, active, sum(CASE WHEN active THEN 0 ELSE 1 END) OVER (ORDER BY wk) AS grp FROM wk_active
  ),
  runs AS (
    SELECT grp, count(*) AS len, max(wk) AS last_wk FROM islands WHERE active GROUP BY grp
  )
  SELECT jsonb_build_object(
    'period', (SELECT jsonb_build_object('week_start', sel_start, 'week_end', (sel_end - 1), 'offset', week_offset) FROM bounds),
    'stats', jsonb_build_object(
      'active_days', jsonb_build_object(
        'this_week', (SELECT count(DISTINCT d) FROM acts_clean, bounds WHERE at >= sel_start AND at < sel_end),
        'prev_week', (SELECT count(DISTINCT d) FROM acts_clean, bounds WHERE at >= sel_start - interval '7 days' AND at < sel_start)),
      'captures', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='capture' AND at >= sel_start AND at < sel_end),
        'prev_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='capture' AND at >= sel_start - interval '7 days' AND at < sel_start)),
      'published', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='publish' AND at >= sel_start AND at < sel_end),
        'prev_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='publish' AND at >= sel_start - interval '7 days' AND at < sel_start)),
      'media', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='media' AND at >= sel_start AND at < sel_end),
        'prev_week', (SELECT count(*) FROM acts_clean, bounds WHERE kind='media' AND at >= sel_start - interval '7 days' AND at < sel_start))
    ),
    'activity', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'week', w.wk,
        'captures',  (SELECT count(*) FROM acts_clean a WHERE a.kind='capture' AND date_trunc('week',a.at)::date=w.wk),
        'published', (SELECT count(*) FROM acts_clean a WHERE a.kind='publish' AND date_trunc('week',a.at)::date=w.wk),
        'media',     (SELECT count(*) FROM acts_clean a WHERE a.kind='media'   AND date_trunc('week',a.at)::date=w.wk)
      ) ORDER BY w.wk), '[]'::jsonb) FROM weeks w),
    'stickiness', jsonb_build_object(
      'avg_active_days_per_week', (SELECT round(avg(c)::numeric, 1) FROM (
          SELECT count(DISTINCT a.d) AS c FROM weeks w
          LEFT JOIN acts_clean a ON date_trunc('week',a.at)::date = w.wk GROUP BY w.wk) t),
      'weekly_active_staff', (SELECT count(DISTINCT staff_id) FROM acts_clean, bounds WHERE staff_id IS NOT NULL AND at >= sel_start AND at < sel_end),
      'total_staff', (SELECT count(*) FROM real_staff),
      'current_streak', (SELECT coalesce((SELECT len FROM runs WHERE last_wk = (SELECT sel_start FROM bounds)), 0)),
      'longest_streak', (SELECT coalesce(max(len), 0) FROM runs),
      'active_days_by_week', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'week', w.wk,
          'days', (SELECT count(DISTINCT a.d) FROM acts_clean a WHERE date_trunc('week',a.at)::date=w.wk)
        ) ORDER BY w.wk), '[]'::jsonb) FROM weeks w)
    ),
    'funnel', (
      WITH win AS (SELECT (SELECT sel_start FROM bounds) - ((n_weeks - 1) * interval '1 week') AS lo,
                          (SELECT sel_end FROM bounds) AS hi)
      SELECT jsonb_build_object(
        'captured',  (SELECT count(*) FROM interviews i, win WHERE i.workspace_id=ws_id AND i.created_at >= win.lo AND i.created_at < win.hi),
        'drafted',   (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo AND c.created_at < win.hi),
        'scheduled', (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo AND c.created_at < win.hi
                        AND (c.scheduled_at IS NOT NULL OR c.status IN ('scheduled','published'))),
        'published', (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo AND c.created_at < win.hi AND c.status='published'),
        'avg_days_to_publish', (SELECT round(avg(extract(epoch FROM (c.published_at - c.created_at))/86400)::numeric, 1)
                        FROM content_items c, win WHERE c.workspace_id=ws_id AND c.status='published'
                          AND c.published_at IS NOT NULL AND c.published_at >= win.lo AND c.published_at < win.hi)
      )
    ),
    'staff', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', rs.id, 'name', rs.name,
        'last_active_at', (SELECT max(a.at) FROM acts_clean a WHERE a.staff_id=rs.id),
        'captures_wk',  (SELECT count(*) FROM acts_clean a, bounds WHERE a.staff_id=rs.id AND a.kind='capture' AND a.at >= sel_start AND a.at < sel_end),
        'published_wk', (SELECT count(*) FROM acts_clean a, bounds WHERE a.staff_id=rs.id AND a.kind='publish' AND a.at >= sel_start AND a.at < sel_end),
        'weeks', (SELECT coalesce(jsonb_agg(CASE WHEN EXISTS (
              SELECT 1 FROM acts_clean a WHERE a.staff_id=rs.id AND date_trunc('week',a.at)::date=w.wk) THEN 1 ELSE 0 END ORDER BY w.wk), '[]'::jsonb) FROM weeks w)
      ) ORDER BY (SELECT max(a.at) FROM acts_clean a WHERE a.staff_id=rs.id) DESC NULLS LAST), '[]'::jsonb) FROM real_staff rs)
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_usage(uuid, int, int) TO service_role;

-- 2-arg shim → delegates to offset 0 (deploy-window safety).
CREATE OR REPLACE FUNCTION public.workspace_usage(ws_id uuid, n_weeks int DEFAULT 12)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.workspace_usage(ws_id, n_weeks, 0) $$;

GRANT EXECUTE ON FUNCTION public.workspace_usage(uuid, int) TO service_role;
