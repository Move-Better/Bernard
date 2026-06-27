-- 147_workspace_usage_fn.sql
-- Aggregation function powering the per-workspace /usage page — "how much is
-- this clinic using Bernard?" Returns, in one round-trip and from existing
-- timestamps only (no new tracking table):
--   • stats      — this-week vs prev-week counts for active_days, captures,
--                  published, media (drives the WoW stat cards).
--   • activity   — last n_weeks of weekly capture/published/media counts.
--   • stickiness — avg active days/week, weekly active staff, total staff,
--                  current + longest active-week streak (gaps & islands over
--                  26 weeks), and an n_weeks active-days sparkline series.
--   • funnel     — captured / drafted / scheduled / published over n_weeks +
--                  avg days capture→publish. (Drafts can exceed captures —
--                  each capture fans out into multiple content_items.)
--   • staff      — per real staff member: last_active_at, captures_4wk,
--                  published_4wk, and an n_weeks active/inactive consistency
--                  strip. E2E/smoke fixture staff are excluded by name.
--
-- "Active day" = a calendar day (UTC) with ANY capture, draft, publish, or
-- media write for the workspace. Read-only; SECURITY DEFINER so it can
-- aggregate the workspace's rows, but every query is scoped to the passed
-- workspace id. Idempotent (CREATE OR REPLACE) — running this IS the apply.

CREATE OR REPLACE FUNCTION public.workspace_usage(ws_id uuid, n_weeks int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
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
    FROM acts a
    WHERE a.at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = a.staff_id
                        AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))
  ),
  real_staff AS (
    SELECT s.id, s.name FROM staff s
    WHERE s.workspace_id = ws_id AND s.name NOT ILIKE '%e2e%' AND s.name NOT ILIKE '%smoke%'
  ),
  weeks AS (
    SELECT gs::date AS wk
    FROM generate_series(
      date_trunc('week', now())::date - ((n_weeks - 1) * interval '1 week'),
      date_trunc('week', now())::date,
      interval '1 week') gs
  ),
  weeks26 AS (
    SELECT gs::date AS wk
    FROM generate_series(
      date_trunc('week', now())::date - (25 * interval '1 week'),
      date_trunc('week', now())::date,
      interval '1 week') gs
  ),
  wk_active AS (
    SELECT w.wk,
      EXISTS (SELECT 1 FROM acts_clean a WHERE date_trunc('week', a.at)::date = w.wk) AS active
    FROM weeks26 w
  ),
  islands AS (
    SELECT wk, active,
      sum(CASE WHEN active THEN 0 ELSE 1 END) OVER (ORDER BY wk) AS grp
    FROM wk_active
  ),
  runs AS (
    SELECT grp, count(*) AS len, max(wk) AS last_wk
    FROM islands WHERE active GROUP BY grp
  )
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'active_days', jsonb_build_object(
        'this_week', (SELECT count(DISTINCT d) FROM acts_clean WHERE at >= now()-interval '7 days'),
        'prev_week', (SELECT count(DISTINCT d) FROM acts_clean WHERE at >= now()-interval '14 days' AND at < now()-interval '7 days')),
      'captures', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean WHERE kind='capture' AND at >= now()-interval '7 days'),
        'prev_week', (SELECT count(*) FROM acts_clean WHERE kind='capture' AND at >= now()-interval '14 days' AND at < now()-interval '7 days')),
      'published', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean WHERE kind='publish' AND at >= now()-interval '7 days'),
        'prev_week', (SELECT count(*) FROM acts_clean WHERE kind='publish' AND at >= now()-interval '14 days' AND at < now()-interval '7 days')),
      'media', jsonb_build_object(
        'this_week', (SELECT count(*) FROM acts_clean WHERE kind='media' AND at >= now()-interval '7 days'),
        'prev_week', (SELECT count(*) FROM acts_clean WHERE kind='media' AND at >= now()-interval '14 days' AND at < now()-interval '7 days'))
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
      'weekly_active_staff', (SELECT count(DISTINCT staff_id) FROM acts_clean WHERE staff_id IS NOT NULL AND at >= now()-interval '7 days'),
      'total_staff', (SELECT count(*) FROM real_staff),
      'current_streak', (SELECT coalesce((SELECT len FROM runs WHERE last_wk = date_trunc('week', now())::date), 0)),
      'longest_streak', (SELECT coalesce(max(len), 0) FROM runs),
      'active_days_by_week', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'week', w.wk,
          'days', (SELECT count(DISTINCT a.d) FROM acts_clean a WHERE date_trunc('week',a.at)::date=w.wk)
        ) ORDER BY w.wk), '[]'::jsonb) FROM weeks w)
    ),
    'funnel', (
      WITH win AS (SELECT now() - (n_weeks * interval '1 week') AS lo)
      SELECT jsonb_build_object(
        'captured',  (SELECT count(*) FROM interviews i, win WHERE i.workspace_id=ws_id AND i.created_at >= win.lo),
        'drafted',   (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo),
        'scheduled', (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo
                        AND (c.scheduled_at IS NOT NULL OR c.status IN ('scheduled','published'))),
        'published', (SELECT count(*) FROM content_items c, win WHERE c.workspace_id=ws_id AND c.created_at >= win.lo AND c.status='published'),
        'avg_days_to_publish', (SELECT round(avg(extract(epoch FROM (c.published_at - c.created_at))/86400)::numeric, 1)
                        FROM content_items c, win WHERE c.workspace_id=ws_id AND c.status='published'
                          AND c.published_at IS NOT NULL AND c.published_at >= win.lo)
      )
    ),
    'staff', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', rs.id, 'name', rs.name,
        'last_active_at', (SELECT max(a.at) FROM acts_clean a WHERE a.staff_id=rs.id),
        'captures_4wk',  (SELECT count(*) FROM acts_clean a WHERE a.staff_id=rs.id AND a.kind='capture' AND a.at >= now()-interval '28 days'),
        'published_4wk', (SELECT count(*) FROM acts_clean a WHERE a.staff_id=rs.id AND a.kind='publish' AND a.at >= now()-interval '28 days'),
        'weeks', (SELECT coalesce(jsonb_agg(CASE WHEN EXISTS (
              SELECT 1 FROM acts_clean a WHERE a.staff_id=rs.id AND date_trunc('week',a.at)::date=w.wk) THEN 1 ELSE 0 END ORDER BY w.wk), '[]'::jsonb) FROM weeks w)
      ) ORDER BY (SELECT max(a.at) FROM acts_clean a WHERE a.staff_id=rs.id) DESC NULLS LAST), '[]'::jsonb) FROM real_staff rs)
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_usage(uuid, int) TO service_role;
