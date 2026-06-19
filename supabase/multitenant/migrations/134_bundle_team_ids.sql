-- bundle.social Team ids for the per-tenant publisher choice (Phase 1).
-- A workspace that publishes via bundle.social (publish_provider='bundle') has
-- one bundle "Team"; a multi-location workspace carries one Team per location
-- for Google Business (one active GBP location per Team — see
-- memory/project-bundle-social.md). Both columns are nullable + additive:
-- workspaces on Buffer (the default) never set them, so this changes no
-- existing behavior. Populated by the bundle connect flow (ensure-team), which
-- derives the team from workspaceContext — never from client input.
--
-- No new GRANT: column adds inherit the existing service_role table grants.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS bundle_team_id text;

ALTER TABLE public.workspace_locations
  ADD COLUMN IF NOT EXISTS bundle_team_id text;
