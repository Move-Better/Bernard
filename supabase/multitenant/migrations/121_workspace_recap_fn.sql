-- 121_workspace_recap_fn.sql
-- Aggregation function powering the Overview "This week" recap — the
-- workspace-wide weekly snapshot reviewed in the all-staff meeting.
--
-- Returns, in one round-trip, the things the client's capped useStories cache
-- CANNOT compute accurately:
--   • team[]  — per real staff member: ALL-TIME published count, this-week
--               published count, last capture timestamp, and the distinct
--               capture-week starts over the last 26 weeks (the client turns
--               that into a consistency "streak").
--   • team_all_time_total — workspace-wide all-time published count.
--   • cost — raw COUNTED usage units (audio seconds transcribed, realtime
--            voice seconds, video seconds encoded, pieces generated) for four
--            windows (this week, the prior week for WoW, month-to-date,
--            year-to-date). Dollars are applied client-side from a rate card
--            (src/lib/costEstimate.js) so rates can be tuned without a migration.
--
-- E2E/smoke fixture staff are excluded from team[] (known contained test rows;
-- see CLAUDE.md). Read-only; SECURITY DEFINER so it can aggregate across the
-- workspace's rows regardless of the caller, but it ONLY ever touches rows
-- scoped by the passed workspace id.

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
           AND c.published_at >= now() - interval '7 days') AS week_published,
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
      ('this_week', now() - interval '7 days',  now()),
      ('prev_week', now() - interval '14 days', now() - interval '7 days'),
      ('mtd',       date_trunc('month', now()), now() + interval '1 second'),
      ('ytd',       date_trunc('year',  now()), now() + interval '1 second')
    ) AS w(label, lo, hi)
  )
  SELECT jsonb_build_object(
    'team', (SELECT coalesce(jsonb_agg(to_jsonb(team) ORDER BY all_time_published DESC, name), '[]'::jsonb) FROM team),
    'team_all_time_total', (SELECT count(*) FROM content_items c
       WHERE c.workspace_id = ws_id AND c.status = 'published'),
    'cost', (SELECT jsonb_object_agg(label, to_jsonb(cost) - 'label') FROM cost)
  );
$$;

GRANT EXECUTE ON FUNCTION public.workspace_recap(uuid) TO service_role;
