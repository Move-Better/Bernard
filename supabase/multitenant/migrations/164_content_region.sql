-- Topic-balance engine: body-region / theme tagging.
--
-- `region` = primary bucket (one of the 12 slugs in api/_lib/topicRegion.js),
-- `theme`  = optional secondary bucket. Classified once from interviews.topic
-- and denormalized onto content_items at draft time (mirrors how `topic` flows).
-- The balance engine reads content_items.region for the rolling-window mix and
-- joins content_plan_atoms -> interviews.region for the pieces being planned.
--
-- Both columns are nullable; a null region means "unclassified" and is treated
-- as exempt (the engine never caps unclassified/general). No new grants needed:
-- columns inherit the existing service_role table grants.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS theme  text;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS theme  text;

-- Supports the rolling-window distribution query (per workspace, per region,
-- over a recent created/scheduled window).
CREATE INDEX IF NOT EXISTS content_items_ws_region_created_idx
  ON public.content_items (workspace_id, region, created_at DESC);
