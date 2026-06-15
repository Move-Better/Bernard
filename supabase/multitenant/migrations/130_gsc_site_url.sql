-- Add Google Search Console site URL to workspaces.
-- Mirrored from workspace_credentials.config.site_url on save/delete
-- by the credentials handler (service='searchconsole'), analogous to
-- ga4_property_id for GA4. Non-sensitive (just an identifier; access is
-- gated by the service-account secret), so it lives on the workspace row
-- so the SPA can check ws.gsc_site_url without a separate credentials fetch.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS gsc_site_url text;
