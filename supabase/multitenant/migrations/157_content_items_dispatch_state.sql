-- 157 — content_items.dispatch_state: idempotency for server-side approve→dispatch.
--
-- Standing Producer Phase 2 Part B (see .claude/standing-producer-sprint.md).
-- When approving a piece on /week now dispatches it server-side (one action =
-- approve + schedule), this column records which targets have already been
-- posted so a retry can never double-post. Shape mirrors
-- story_packages.auto_publish_state.published_channels exactly, and reuses the
-- same monotonic append-only primitives (api/_lib/autoPublishRetry.js:
-- unpostedTargets / mergePostedLocations):
--
--   {
--     "published_channels": {
--       "<platform>": {                 -- e.g. "gbp", "instagram"
--         "content_item_id": "<uuid>",
--         "locations": {                -- append-only; a key is NEVER overwritten
--           "<target_id>": { "post_id": "<bundle post id>", "fired_at": "<iso>" }
--         }
--       }
--     },
--     "retry_count": <int>,
--     "last_error": "<string>"
--   }
--
-- For non-GBP platforms there is a single synthetic target keyed by the platform
-- name; for GBP each key is a workspace_locations.id (the per-location fan-out).

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS dispatch_state jsonb NOT NULL DEFAULT '{}'::jsonb;

-- dispatching_at: the atomic-claim lock for server-side dispatch. Two concurrent
-- approves of the same piece must not both post (the exact double-post the
-- auto-publish cron guards against). The dispatcher claims the row with
--   PATCH ...?id=eq.<id>&or=(dispatching_at.is.null,dispatching_at.lt.<stale>)
--        SET dispatching_at=now  (Prefer: return=representation)
-- and only proceeds if it got the row back. Cleared (null) on completion or
-- error; a stale claim (> the function's max duration) is reclaimable so a
-- crashed dispatch can't wedge a piece forever.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS dispatching_at timestamptz;
