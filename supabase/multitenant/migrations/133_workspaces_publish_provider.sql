-- Per-workspace social-publishing provider flag for the Buffer -> bundle.social
-- migration (memory/project-bundle-social.md).
--
-- Default 'buffer' so every existing workspace keeps publishing through Buffer
-- with byte-for-byte unchanged behavior. A workspace is opted into bundle.social
-- by setting this to 'bundle' (a later phase — Phase 0 ships only the adapter
-- seam and changes no runtime routing). The resolver getPublisher(ws) in
-- api/_lib/social/index.js reads this column via the existing select=* on the
-- workspaces row, and falls back to Buffer when it is absent/unknown.
--
-- No new GRANT needed: service_role already holds table-level privileges on
-- public.workspaces, and a column add inherits them (same as migration 125).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS publish_provider text NOT NULL DEFAULT 'buffer';

-- Constrain to known providers. DROP then ADD so the migration is idempotent
-- (re-running won't error on an already-present constraint).
ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_publish_provider_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_publish_provider_check
  CHECK (publish_provider IN ('buffer', 'bundle'));
