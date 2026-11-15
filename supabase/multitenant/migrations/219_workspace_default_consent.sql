-- Migration 219: per-workspace default consent for new media
--
-- Move Better collects consent before filming and keeps it in the Jane
-- patient file (Q, 2026-11-14), so its new media should be born
-- consent_status = 'obtained'. Other workspaces keep 'not_required'.
--
-- No insert path sets consent_status explicitly; they all take the column
-- default 'not_required'. The trigger swaps that default for the
-- workspace's own default on INSERT only. Later edits are untouched.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS default_consent_status text NOT NULL DEFAULT 'not_required'
  CHECK (default_consent_status IN ('not_required','pending','obtained'));

CREATE OR REPLACE FUNCTION public.media_assets_workspace_consent_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.consent_status = 'not_required' THEN
    SELECT w.default_consent_status INTO NEW.consent_status
      FROM public.workspaces w WHERE w.id = NEW.workspace_id;
    NEW.consent_status := COALESCE(NEW.consent_status, 'not_required');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS media_assets_workspace_consent_default ON public.media_assets;
CREATE TRIGGER media_assets_workspace_consent_default
  BEFORE INSERT ON public.media_assets
  FOR EACH ROW EXECUTE FUNCTION public.media_assets_workspace_consent_default();

GRANT EXECUTE ON FUNCTION public.media_assets_workspace_consent_default() TO service_role;

UPDATE public.workspaces SET default_consent_status = 'obtained'
 WHERE slug IN ('movebetter','movebetter-equine','movebetter-animals');
