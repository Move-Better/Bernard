-- 190 — workspace_video_templates
--
-- The reel equivalent of workspace_photo_templates (066 / 131). Mirrors that
-- table deliberately: same columns, same one-default-per-workspace partial
-- unique index, same cascade — so the CRUD routes and settings UI can be a
-- direct port rather than a parallel invention.
--
-- ALSO: drops the CHECK added in 189, which hardcoded the four built-in preset
-- ids. That constraint made a user-created template id impossible to store —
-- it was written for a closed enum and this migration is what opens the set.
-- workspaces.reel_preset now follows the same convention as
-- content_items.photo_template_id: a built-in slug OR a custom uuid, validated
-- in the API rather than by a constraint that has to be migrated every time a
-- built-in is added.

CREATE TABLE IF NOT EXISTS public.workspace_video_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_video_templates_ws_idx
  ON public.workspace_video_templates (workspace_id, created_at);

-- At most one default per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_video_templates_one_default
  ON public.workspace_video_templates (workspace_id)
  WHERE is_default;

COMMENT ON TABLE public.workspace_video_templates IS
  'User-authored reel looks. config matches BUILTIN_VIDEO_TEMPLATES in api/_lib/videoTemplates.js.';

-- 189 shipped this as a closed enum. A custom template id can never satisfy it.
ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_reel_preset_check;

COMMENT ON COLUMN public.workspaces.reel_preset IS
  'Pinned reel template — a built-in slug (api/_lib/videoTemplates.js) or a workspace_video_templates uuid. NULL = use the workspace default, else the built-in hook_card.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_video_templates TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
