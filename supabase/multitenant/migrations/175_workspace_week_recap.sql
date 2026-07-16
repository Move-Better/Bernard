-- 175_workspace_week_recap.sql
-- Overview v2: navigable calendar-week recap (audit 2026-07-16).
--
-- Two changes:
--
-- 1. NEW workspace_week_recap(ws_id, wk_offset) — one selected calendar week
--    (Mon–Sun UTC, matching periodMath.js and date_trunc('week')) of recap
--    facts, for the Overview week navigator:
--      • published / captured / drafted counts for the week, plus the same
--        counts for the week before (the UI's "vs last wk" delta chips)
--      • cost units for both weeks (dollars applied client-side, same rate
--        card as workspace_recap)
--      • published_items[] grouped by interview (topic, staff, platforms,
--        published_at, has_video) and captured_items[]
--      • top_candidates[] — each published item's LATEST engagement snapshot
--        (source + stats); the API layer scores them with the shared
--        scoreSnapshot() and picks the top post, so the source-specific
--        field mapping lives in exactly one place (engagementScoring.js).
--    wk_offset is 0 (this week) or negative; clamped to [-1040, 0].
--
-- 2. workspace_recap(ws_id) updated (CREATE OR REPLACE):
--      • team[].week_published now counts the CURRENT CALENDAR WEEK instead
--        of a rolling 7 days — one definition of "week" across the page.
--      • cost.this_week / cost.prev_week likewise move to calendar weeks
--        (the Insights cost strip already sits next to calendar-week social
--        numbers, so this fixes a quiet inconsistency there too).
--      • NEW 'trend': last 12 calendar weeks of {week_start, published,
--        captured, pieces, transcribe_sec, voice_sec, video_sec} powering
--        the Overview trend band + cost mini-trend.
--      • NEW 'first_week': the earliest week with any activity — the week
--        navigator's floor (workspace-lifetime history, no arbitrary cap).
--
-- E2E/smoke fixture staff are excluded from team[], captured counts, and
-- published/captured item lists (known contained test rows; see CLAUDE.md).
-- Read-only; SECURITY DEFINER but only ever touches rows scoped by ws_id.

CREATE OR REPLACE FUNCTION public.workspace_week_recap(ws_id uuid, wk_offset int DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  win AS (
    SELECT date_trunc('week', now()) + LEAST(0, GREATEST(-1040, wk_offset)) * interval '1 week' AS lo,
           date_trunc('week', now()) + (LEAST(0, GREATEST(-1040, wk_offset)) + 1) * interval '1 week' AS hi
  ),
  pwin AS (SELECT lo - interval '1 week' AS lo, lo AS hi FROM win),
  pub_items AS (
    SELECT coalesce(c.interview_id::text, 'item-' || c.id::text) AS grp,
           c.interview_id,
           coalesce(max(i.topic), max(c.topic), 'Untitled') AS topic,
           max(s.name) AS staff_name,
           array_agg(DISTINCT c.platform) AS platforms,
           max(c.published_at) AS published_at,
           bool_or(c.platform IN ('youtube', 'tiktok')) AS has_video
    FROM content_items c
    LEFT JOIN interviews i ON i.id = c.interview_id
    LEFT JOIN staff s ON s.id = c.staff_id
    , win
    WHERE c.workspace_id = ws_id AND c.status = 'published'
      AND c.published_at >= win.lo AND c.published_at < win.hi
      AND (s.id IS NULL OR (s.name NOT ILIKE '%e2e%' AND s.name NOT ILIKE '%smoke%'))
    GROUP BY grp, c.interview_id
  )
  SELECT jsonb_build_object(
    'week_start', (SELECT lo::date FROM win),
    'week_end',   (SELECT hi::date FROM win),
    'published', (SELECT count(*) FROM content_items c, win
       WHERE c.workspace_id = ws_id AND c.status = 'published'
         AND c.published_at >= win.lo AND c.published_at < win.hi),
    'captured', (SELECT count(*) FROM interviews i, win
       WHERE i.workspace_id = ws_id AND i.created_at >= win.lo AND i.created_at < win.hi
         AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = i.staff_id
                           AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))),
    'drafted', (SELECT count(*) FROM content_items c, win
       WHERE c.workspace_id = ws_id AND c.created_at >= win.lo AND c.created_at < win.hi),
    'cost', (SELECT jsonb_build_object(
       'pieces', (SELECT count(*) FROM content_items c
          WHERE c.workspace_id = ws_id AND c.created_at >= win.lo AND c.created_at < win.hi),
       'transcribe_sec', (SELECT coalesce(sum(coalesce(i.source_audio_duration_sec, 0)), 0) FROM interviews i
          WHERE i.workspace_id = ws_id AND i.created_at >= win.lo AND i.created_at < win.hi),
       'voice_sec', (SELECT coalesce(sum(coalesce(i.realtime_voice_seconds, 0)), 0) FROM interviews i
          WHERE i.workspace_id = ws_id AND i.created_at >= win.lo AND i.created_at < win.hi),
       'video_sec', (SELECT coalesce(sum(coalesce(m.duration_s, 0)), 0) FROM media_assets m
          WHERE m.workspace_id = ws_id AND m.kind = 'video'
            AND m.created_at >= win.lo AND m.created_at < win.hi)
     ) FROM win),
    'prev', (SELECT jsonb_build_object(
       'published', (SELECT count(*) FROM content_items c
          WHERE c.workspace_id = ws_id AND c.status = 'published'
            AND c.published_at >= pwin.lo AND c.published_at < pwin.hi),
       'captured', (SELECT count(*) FROM interviews i
          WHERE i.workspace_id = ws_id AND i.created_at >= pwin.lo AND i.created_at < pwin.hi
            AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = i.staff_id
                              AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))),
       'drafted', (SELECT count(*) FROM content_items c
          WHERE c.workspace_id = ws_id AND c.created_at >= pwin.lo AND c.created_at < pwin.hi),
       'cost', jsonb_build_object(
         'pieces', (SELECT count(*) FROM content_items c
            WHERE c.workspace_id = ws_id AND c.created_at >= pwin.lo AND c.created_at < pwin.hi),
         'transcribe_sec', (SELECT coalesce(sum(coalesce(i.source_audio_duration_sec, 0)), 0) FROM interviews i
            WHERE i.workspace_id = ws_id AND i.created_at >= pwin.lo AND i.created_at < pwin.hi),
         'voice_sec', (SELECT coalesce(sum(coalesce(i.realtime_voice_seconds, 0)), 0) FROM interviews i
            WHERE i.workspace_id = ws_id AND i.created_at >= pwin.lo AND i.created_at < pwin.hi),
         'video_sec', (SELECT coalesce(sum(coalesce(m.duration_s, 0)), 0) FROM media_assets m
            WHERE m.workspace_id = ws_id AND m.kind = 'video'
              AND m.created_at >= pwin.lo AND m.created_at < pwin.hi)
       )
     ) FROM pwin),
    'published_items', (SELECT coalesce(jsonb_agg(to_jsonb(p) - 'grp' ORDER BY p.published_at DESC), '[]'::jsonb)
       FROM pub_items p),
    'captured_items', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'interview_id', i.id, 'topic', i.topic, 'staff_name', s.name, 'created_at', i.created_at)
        ORDER BY i.created_at DESC), '[]'::jsonb)
       FROM interviews i LEFT JOIN staff s ON s.id = i.staff_id, win
       WHERE i.workspace_id = ws_id AND i.created_at >= win.lo AND i.created_at < win.hi
         AND (s.id IS NULL OR (s.name NOT ILIKE '%e2e%' AND s.name NOT ILIKE '%smoke%'))),
    'top_candidates', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'content_item_id', c.id, 'topic', c.topic, 'platform', c.platform,
        'source', es.source, 'stats', es.stats)), '[]'::jsonb)
       FROM content_items c
       LEFT JOIN LATERAL (
         SELECT e.source, e.stats FROM engagement_snapshots e
         WHERE e.content_item_id = c.id ORDER BY e.fetched_at DESC LIMIT 1
       ) es ON true, win
       WHERE c.workspace_id = ws_id AND c.status = 'published'
         AND c.published_at >= win.lo AND c.published_at < win.hi
         AND es.source IS NOT NULL)
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_week_recap(uuid, int) TO service_role;

CREATE OR REPLACE FUNCTION public.workspace_recap(ws_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  team AS (
    SELECT
      s.id,
      s.name,
      (SELECT count(*) FROM content_items c
         WHERE c.staff_id = s.id AND c.status = 'published') AS all_time_published,
      (SELECT count(*) FROM content_items c
         WHERE c.staff_id = s.id AND c.status = 'published'
           AND c.published_at >= date_trunc('week', now())) AS week_published,
      (SELECT max(i.created_at) FROM interviews i WHERE i.staff_id = s.id) AS last_capture_at,
      (SELECT coalesce(array_agg(DISTINCT date_trunc('week', i.created_at)::date), '{}')
         FROM interviews i
         WHERE i.staff_id = s.id
           AND i.created_at >= now() - interval '26 weeks') AS capture_weeks
    FROM staff s
    WHERE s.workspace_id = ws_id
      AND s.name NOT ILIKE '%e2e%'
      AND s.name NOT ILIKE '%smoke%'
  ),
  cost AS (
    SELECT w.label,
      (SELECT count(*) FROM content_items c
         WHERE c.workspace_id = ws_id AND c.created_at >= w.lo AND c.created_at < w.hi) AS pieces,
      (SELECT coalesce(sum(coalesce(i.source_audio_duration_sec, 0)), 0) FROM interviews i
         WHERE i.workspace_id = ws_id AND i.created_at >= w.lo AND i.created_at < w.hi) AS transcribe_sec,
      (SELECT coalesce(sum(coalesce(i.realtime_voice_seconds, 0)), 0) FROM interviews i
         WHERE i.workspace_id = ws_id AND i.created_at >= w.lo AND i.created_at < w.hi) AS voice_sec,
      (SELECT coalesce(sum(coalesce(m.duration_s, 0)), 0) FROM media_assets m
         WHERE m.workspace_id = ws_id AND m.kind = 'video'
           AND m.created_at >= w.lo AND m.created_at < w.hi) AS video_sec
    FROM (VALUES
      ('this_week', date_trunc('week', now()),                     now() + interval '1 second'),
      ('prev_week', date_trunc('week', now()) - interval '1 week', date_trunc('week', now())),
      ('mtd',       date_trunc('month', now()), now() + interval '1 second'),
      ('ytd',       date_trunc('year',  now()), now() + interval '1 second'),
      ('all',       '-infinity'::timestamptz,   now() + interval '1 second')
    ) AS w(label, lo, hi)
  ),
  trend_weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - interval '11 weeks',
      date_trunc('week', now()),
      interval '1 week') AS wk
  ),
  trend AS (
    SELECT tw.wk,
      (SELECT count(*) FROM content_items c
         WHERE c.workspace_id = ws_id AND c.status = 'published'
           AND c.published_at >= tw.wk AND c.published_at < tw.wk + interval '1 week') AS published,
      (SELECT count(*) FROM interviews i
         WHERE i.workspace_id = ws_id
           AND i.created_at >= tw.wk AND i.created_at < tw.wk + interval '1 week'
           AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = i.staff_id
                             AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))) AS captured,
      (SELECT count(*) FROM content_items c
         WHERE c.workspace_id = ws_id
           AND c.created_at >= tw.wk AND c.created_at < tw.wk + interval '1 week') AS pieces,
      (SELECT coalesce(sum(coalesce(i.source_audio_duration_sec, 0)), 0) FROM interviews i
         WHERE i.workspace_id = ws_id
           AND i.created_at >= tw.wk AND i.created_at < tw.wk + interval '1 week') AS transcribe_sec,
      (SELECT coalesce(sum(coalesce(i.realtime_voice_seconds, 0)), 0) FROM interviews i
         WHERE i.workspace_id = ws_id
           AND i.created_at >= tw.wk AND i.created_at < tw.wk + interval '1 week') AS voice_sec,
      (SELECT coalesce(sum(coalesce(m.duration_s, 0)), 0) FROM media_assets m
         WHERE m.workspace_id = ws_id AND m.kind = 'video'
           AND m.created_at >= tw.wk AND m.created_at < tw.wk + interval '1 week') AS video_sec
    FROM trend_weeks tw
  )
  SELECT jsonb_build_object(
    'team', (SELECT coalesce(jsonb_agg(to_jsonb(team) ORDER BY all_time_published DESC, name), '[]'::jsonb) FROM team),
    'team_all_time_total', (SELECT count(*) FROM content_items c
       WHERE c.workspace_id = ws_id AND c.status = 'published'),
    'all_time', jsonb_build_object(
      'captured', (SELECT count(*) FROM interviews i
         WHERE i.workspace_id = ws_id
           AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.id = i.staff_id
                             AND (s.name ILIKE '%e2e%' OR s.name ILIKE '%smoke%'))),
      'contributors', (SELECT count(*) FROM team WHERE all_time_published > 0 OR last_capture_at IS NOT NULL)
    ),
    'cost', (SELECT jsonb_object_agg(label, to_jsonb(cost) - 'label') FROM cost),
    'trend', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'week_start', wk::date, 'published', published, 'captured', captured, 'pieces', pieces,
        'transcribe_sec', transcribe_sec, 'voice_sec', voice_sec, 'video_sec', video_sec)
        ORDER BY wk), '[]'::jsonb) FROM trend),
    'first_week', (SELECT least(
        (SELECT date_trunc('week', min(c.created_at))::date FROM content_items c WHERE c.workspace_id = ws_id),
        (SELECT date_trunc('week', min(i.created_at))::date FROM interviews i WHERE i.workspace_id = ws_id)))
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_recap(uuid) TO service_role;
