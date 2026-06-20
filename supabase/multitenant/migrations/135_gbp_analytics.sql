-- GBP Analytics columns
--
-- gbp_location_name on workspaces: the primary GBP location resource name
-- (format: locations/{locationId}) detected at OAuth connect time and used
-- by the Performance API. Mirrors config.location_name from the
-- workspace_credentials row for fast lookups without joining.
--
-- gbp_post_name on content_items: the GBP local post resource name
-- (format: accounts/{acctId}/locations/{locId}/localPosts/{postId})
-- written by the refresh-engagement cron when it matches a published GBP
-- content item to a local post by timestamp proximity. Used by the cron to
-- call reportInsights for per-post view counts.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS gbp_location_name text;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS gbp_post_name text;
