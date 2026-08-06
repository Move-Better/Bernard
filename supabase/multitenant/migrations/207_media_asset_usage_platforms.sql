-- Add a per-platform PUBLISHED rollup to media_asset_usage (migration 185).
--
-- Feedback bdae4d9d-bfcd-48dc-ad51-60c9b9c2f977 (Philip): the reuse badge
-- should say WHICH platform a photo went out on, and the count should only
-- reflect published posts, not drafts sitting in the queue. use_count /
-- published_count already exist; this adds the "where" as a jsonb map of
-- platform -> published count, e.g. {"instagram": 3, "linkedin": 1} — drafts
-- and rejected posts are deliberately excluded from this map, same filter as
-- published_count, so the tooltip and drawer never have to re-derive it.
--
-- Two-level GROUP BY (refs -> by_platform -> platform_agg), not a lateral
-- correlated subquery per join row — the earlier draft of this migration did
-- a `cross join lateral (select ... from content_items ci2 ...)` per
-- (content_item, media_url) pair, re-scanning the whole table on every row.
-- This version scans content_items once and aggregates twice, same shape as
-- 185's own approach.
--
-- CREATE OR REPLACE VIEW can't add a column ahead of existing ones or change
-- an existing column's type, but appending a new trailing column is safe —
-- every existing SELECT list in list.js / [id].js names its columns
-- explicitly rather than `select=*`, so nothing downstream breaks.

create or replace view public.media_asset_usage as
with refs as (
  select
    ci.workspace_id,
    (lower(m->>'mediaAssetId'))::uuid as asset_id,
    ci.id,
    ci.platform,
    ci.status,
    ci.published_at,
    ci.created_at
  from public.content_items ci
  cross join lateral jsonb_array_elements(coalesce(ci.media_urls, '[]'::jsonb)) m
  where ci.archived_at is null
    and m->>'mediaAssetId' is not null
    and lower(m->>'mediaAssetId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
by_platform as (
  select
    workspace_id,
    asset_id,
    platform,
    count(distinct id) filter (where status = 'published')::int as pub_count
  from refs
  group by workspace_id, asset_id, platform
),
platform_agg as (
  select
    workspace_id,
    asset_id,
    jsonb_object_agg(platform, pub_count) as published_platforms
  from by_platform
  where pub_count > 0
  group by workspace_id, asset_id
)
select
  r.workspace_id,
  r.asset_id,
  count(distinct r.id)::int                                         as use_count,
  count(distinct r.id) filter (where r.status = 'published')::int   as published_count,
  max(coalesce(r.published_at, r.created_at))                       as last_used_at,
  coalesce(pa.published_platforms, '{}'::jsonb)                     as published_platforms
from refs r
left join platform_agg pa
  on pa.workspace_id = r.workspace_id and pa.asset_id = r.asset_id
group by r.workspace_id, r.asset_id, pa.published_platforms;

comment on view public.media_asset_usage is
  'Per-workspace media reuse counter derived from content_items.media_urls[].mediaAssetId. use_count = distinct non-archived posts the asset is attached to; published_count = the subset already live; published_platforms = {platform: published_count} for the same subset, drafts/rejected excluded.';

grant select on public.media_asset_usage to service_role;
