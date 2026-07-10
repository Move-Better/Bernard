-- 167_rename_slate_capabilities.sql
--
-- Retire the 'slate.*' capability keys and the media_assets.source='slate'
-- provenance value, renaming both to the 'moments' scheme (Moment Miner was
-- née Slate, renamed 2026-06-21; code keys/values swept 2026-07-10).
--
-- Data-only backfill (no schema change → expected-schema.json unaffected).
-- Idempotent: re-running matches nothing once applied.
--
-- Safe in any deploy order: api/_lib/capabilities.js normalizes any residual
-- stored 'slate.*' key forward via LEGACY_CAP_ALIASES, and no route enforces
-- the moments.* capability (Moment Miner endpoints gate on requireRole). This
-- migration is the cleanup that lets the legacy alias eventually be removed.

-- 1. Workspace role-template overrides — cap-id strings inside a JSON array.
UPDATE workspaces
SET role_templates = replace(
      replace(role_templates::text, '"slate.generate"', '"moments.generate"'),
      '"slate.approve"', '"moments.approve"'
    )::jsonb
WHERE role_templates::text LIKE '%"slate.generate"%'
   OR role_templates::text LIKE '%"slate.approve"%';

-- 2. Per-staff capability overrides — cap-id strings as JSON object keys.
UPDATE staff
SET capability_overrides = replace(
      replace(capability_overrides::text, '"slate.generate"', '"moments.generate"'),
      '"slate.approve"', '"moments.approve"'
    )::jsonb
WHERE capability_overrides::text LIKE '%"slate.generate"%'
   OR capability_overrides::text LIKE '%"slate.approve"%';

-- 3. media_assets provenance origin tag written by saveBroll().
UPDATE media_assets SET source = 'moments' WHERE source = 'slate';
