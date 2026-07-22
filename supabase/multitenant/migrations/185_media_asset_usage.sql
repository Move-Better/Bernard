-- Media usage counter: how many posts a photo/video has been used in.
--
-- DERIVED, not denormalized. media_assets.content_item_ids has existed since
-- 001_init and is empty on all 1,433 prod rows — nothing ever wrote it, so the
-- "used xN" badge in MediaGrid.jsx has silently rendered nothing for every
-- asset since it shipped. Keeping a counter column in sync would mean writing
-- from all six attach paths (MediaPicker, suggest-media, carousel auto-attach,
-- clipDraft, SlideEditor, UnifiedEditor) plus every detach/delete — the exact
-- drift that produced the dead column. A view can't drift: content_items
-- .media_urls IS the attachment record, so read the count straight off it.
--
-- Shape: one row per (workspace_id, asset_id) that is referenced by at least
-- one non-archived content_item. Assets never used simply have no row — the
-- API defaults them to zero rather than the view carrying 1,300 zero rows.
--
-- The regex WHERE guards the ::uuid cast: media_urls is client-written jsonb,
-- so a malformed mediaAssetId would otherwise error the whole view. Both the
-- filter and the cast sit at the same query level, so the cast only ever sees
-- rows that already passed the regex.

create or replace view public.media_asset_usage as
select
  ci.workspace_id,
  (lower(m->>'mediaAssetId'))::uuid                                        as asset_id,
  count(distinct ci.id)::int                                               as use_count,
  count(distinct ci.id) filter (where ci.status = 'published')::int        as published_count,
  max(coalesce(ci.published_at, ci.created_at))                            as last_used_at
from public.content_items ci
cross join lateral jsonb_array_elements(coalesce(ci.media_urls, '[]'::jsonb)) m
where ci.archived_at is null
  and m->>'mediaAssetId' is not null
  and lower(m->>'mediaAssetId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
group by ci.workspace_id, (lower(m->>'mediaAssetId'))::uuid;

comment on view public.media_asset_usage is
  'Per-workspace media reuse counter derived from content_items.media_urls[].mediaAssetId. use_count = distinct non-archived posts the asset is attached to; published_count = the subset already live.';

grant select on public.media_asset_usage to service_role;
