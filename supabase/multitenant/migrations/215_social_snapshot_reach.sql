-- 215: social_channel_snapshots — account-level reach/engagement columns +
-- an idempotent-sync unique key.
--
-- Why: the 2026-09-15 reel kill criterion (decisions.md, 2026-07-21
-- "Auto-draft Reels") requires "IG reach clearly up", but this table only
-- carried post_count/followers. bundle.social's account-analytics items also
-- carry impressions / impressionsUnique / views / viewsUnique / likes /
-- comments — verified live 2026-09-04 against the movebetter IG:
--   - impressions IS populated (~8.2k on Aug 5 → ~17.7k on Aug 30);
--   - values move DOWN as well as up day to day, so it is a trailing-window
--     metric, NOT a cumulative counter like post_count;
--   - impressions == impressionsUnique on every observed item (bundle appears
--     to mirror one platform metric into both — store both anyway in case
--     they diverge on other platforms or after a Meta API change);
--   - bundle retains only ~31 daily items per account (a sliding window), so
--     any day not persisted into this table is unrecoverable later. That is
--     why all six metrics land in this migration rather than just "reach".
--
-- The unique key lets the cron upsert bundle's whole retained series
-- (PostgREST on_conflict + resolution=merge-duplicates) instead of inserting
-- only the newest item: a missed weekly run now self-heals up to ~31 days
-- back, and the first post-deploy run backfills August's daily series.
-- Safe to add: verified live 2026-09-04 — 28 rows, 28 distinct
-- (workspace_id, platform, snapshot_at) keys, 0 null snapshot_at. Rows with a
-- null snapshot_at would not be deduped by this index (NULLs are distinct),
-- but the cron filters those out before insert.
--
-- No new GRANTs needed: the table-level grants from 180 cover added columns,
-- and indexes carry no grants.

ALTER TABLE public.social_channel_snapshots
  ADD COLUMN IF NOT EXISTS impressions        bigint,   -- trailing-window impressions as bundle reports them (null = platform didn't report)
  ADD COLUMN IF NOT EXISTS impressions_unique bigint,   -- "reach" (unique accounts); observed identical to impressions on IG
  ADD COLUMN IF NOT EXISTS views              bigint,   -- small on IG (~130-200) — likely profile views, also trailing-window
  ADD COLUMN IF NOT EXISTS views_unique       bigint,   -- 0 on IG in every observed item; may populate on other platforms
  ADD COLUMN IF NOT EXISTS likes              integer,  -- trailing-window engagement, not lifetime totals
  ADD COLUMN IF NOT EXISTS comments           integer;

CREATE UNIQUE INDEX IF NOT EXISTS social_channel_snapshots_ws_platform_snapshot_key
  ON public.social_channel_snapshots (workspace_id, platform, snapshot_at);
