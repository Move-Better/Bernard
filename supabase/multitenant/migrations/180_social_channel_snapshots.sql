-- 180: social_channel_snapshots — account-level post/follower counts per
-- connected social channel, captured weekly from bundle.social's own daily
-- account-analytics snapshots (cron/snapshot-social-posts).
--
-- Why: the /outcome-review adoption denominator. content_items only knows the
-- posts Bernard published; bundle's account-level postCount is the channel's
-- CUMULATIVE total (native posts included), so the delta between two rows
-- bracketing a month = the clinic's total posts that month. Bernard-published
-- vs that total is the churn signal (staff posting natively around Bernard).
--
-- Rows are append-only snapshots; readers take the row nearest each month
-- boundary per (workspace_id, platform).

CREATE TABLE IF NOT EXISTS public.social_channel_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform         text NOT NULL,            -- bundle social account type, e.g. INSTAGRAM / FACEBOOK
  account_username text,
  post_count       integer,                  -- cumulative account-level total posts at snapshot time (null = platform didn't report)
  followers        integer,
  snapshot_at      timestamptz,              -- bundle's own snapshot timestamp
  captured_at      timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'bundle'
);

CREATE INDEX IF NOT EXISTS social_channel_snapshots_ws_platform_idx
  ON public.social_channel_snapshots (workspace_id, platform, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_channel_snapshots TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
