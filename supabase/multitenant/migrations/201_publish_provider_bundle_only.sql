-- 201_publish_provider_bundle_only.sql — tighten publish_provider to bundle.
--
-- Migration 197 flipped the default to 'bundle' and migrated the six dormant
-- 'buffer' workspaces, but deliberately left 'buffer' in the CHECK so the column
-- could be read and rolled back "until the Buffer code path is deleted."
--
-- That code path is now deleted, so this closes the trapdoor. Until now the UI
-- still offered "Switch to Buffer" and api/_routes/workspace/me.js still accepted
-- the value, while the three publish paths disagreed about what it meant:
--   - publish/social.js ignored the column and always used bundle
--   - dispatchContentItem.js sent every piece to the client fallback
--   - cron/auto-publish.js took a Buffer branch needing api.buffer.com
-- So a tenant could set a value that silently broke their own publishing.
--
-- Safe to tighten: prod is 7/7 'bundle' (verified 2026-07-30, and again in the
-- guard below). The column is kept rather than dropped — it is read in several
-- places and still names a real thing; it just has one legal value now.

-- Fail loudly rather than silently skipping a row the CHECK would reject.
DO $$
DECLARE stragglers int;
BEGIN
  SELECT count(*) INTO stragglers FROM public.workspaces WHERE publish_provider IS DISTINCT FROM 'bundle';
  IF stragglers > 0 THEN
    RAISE EXCEPTION 'publish_provider: % row(s) are not bundle — migrate them before tightening the CHECK', stragglers;
  END IF;
END $$;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_publish_provider_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_publish_provider_check
  CHECK (publish_provider IN ('bundle'));

COMMENT ON COLUMN public.workspaces.publish_provider IS
  'Outbound social provider. bundle.social is the only permitted value (migration 201); the Buffer provider and its code path were retired 2026-07-30.';
