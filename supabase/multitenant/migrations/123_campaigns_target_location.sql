-- A1 — campaign location aim.
--
-- A campaign can now name a single "promote this location" target. When set,
-- the campaign's CAMPAIGN FOCUS prompt block (api/_lib/tentpoleCampaignContext.js)
-- overlays that location's city / keyword / hashtag / visit_url so ALL channels
-- (IG / FB / blog / email / GBP) lean toward driving people to that clinic —
-- the "we opened a new location, send people there" lever.
--
-- This is distinct from the real GBP publish-routing (workspace_locations.gbp_location_id
-- → per-listing Buffer channel), which is unchanged. It is also distinct from the
-- per-piece interviews/content_items.location_id tag retired in #1215.
--
-- ON DELETE SET NULL: archiving/removing a location must not delete the campaign,
-- it just drops the aim back to brand-wide.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS target_location_id uuid
  REFERENCES public.workspace_locations(id) ON DELETE SET NULL;

-- campaigns already carries service_role grants (045_campaigns.sql), but bundle
-- inline per project convention so this migration is self-sufficient.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO service_role;
