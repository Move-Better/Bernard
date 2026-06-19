-- 132_ad_creatives.sql
--
-- Ad-creative export (Phase 3). Stores an exported ad pack so the /ads surface
-- can list creative grouped by campaign and re-download anytime. Read-only
-- provenance pointers to the source (no cascade off them); campaign_id is
-- ON DELETE SET NULL so deleting a campaign never destroys its ad creative.

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id     uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  source_asset_id uuid,          -- media_assets.id provenance (no FK: pointer only)
  source_piece_id uuid,          -- content_items.id provenance (no FK: pointer only)
  media_type      text NOT NULL DEFAULT 'photo',  -- 'photo' | 'video'
  treatment       jsonb,         -- render spec, for re-render later
  sizes           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{aspect,url,width,height}]
  caption         text,
  title           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_creatives TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE INDEX IF NOT EXISTS ad_creatives_ws_campaign_idx
  ON public.ad_creatives (workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS ad_creatives_ws_created_idx
  ON public.ad_creatives (workspace_id, created_at DESC);
