-- Editor version history (WS5): rolling snapshots of the video / slide editor
-- draft so a user can browse and restore past versions. Appended on save
-- (throttled client-side to ~one per few minutes) and pruned to the most recent
-- N per subject by the API. Additive; no existing table touched.
CREATE TABLE IF NOT EXISTS public.editor_revisions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('video', 'slides')),
  subject_id   text NOT NULL,
  doc          jsonb NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_revisions_subject_idx
  ON public.editor_revisions (subject_type, subject_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.editor_revisions TO service_role;
