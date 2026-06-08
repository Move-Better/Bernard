-- 126_rebrand_to_bernard.sql
--
-- Product rename NarrateRx → Bernard. Updates the LIVE, user-visible brand
-- string in workspaces.app_name. The parent brand "Move Better" stays, so this
-- only swaps the trailing product token:
--   'Move Better — NarrateRx'                       → 'Move Better — Bernard'
--   'Move Better Equine — NarrateRx'                → 'Move Better Equine — Bernard'
--   'Move Better Animals Chiropractic — NarrateRx'  → 'Move Better Animals Chiropractic — Bernard'
--
-- Idempotent: the WHERE filter no-ops once applied. Apply via Supabase MCP
-- execute_sql (prototype the SELECT first) against the shared narraterx project
-- (ref wrqfrjhevkbbheymzezy — immutable, unchanged). No new objects → no grants.
--
-- NOT applied to prod by the rebrand code PR; apply during the cutover window
-- (Phase 3) so the DB string flips together with the deployed brand.

UPDATE public.workspaces
SET    app_name = replace(app_name, 'NarrateRx', 'Bernard')
WHERE  app_name LIKE '%NarrateRx%';

-- TODO (cutover audit, manual): check workspace_credentials.config for any TDC
-- newsletter template_name / copy_header strings that embed "NarrateRx" and
-- UPDATE them the same way. These are per-tenant JSONB values, so verify the
-- live rows first:
--   SELECT workspace_id, service, config
--   FROM   public.workspace_credentials
--   WHERE  config::text LIKE '%NarrateRx%';
