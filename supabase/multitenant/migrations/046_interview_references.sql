-- interview_references: external articles/URLs attached to either a topic
-- (pre-interview reference material) or a completed interview (post-interview
-- reading / source list). Display-only by default; `use_as_source` is a flag
-- for a future "feed to AI" path — no ingestion logic exists yet.
--
-- Exactly one of (topic_id, interview_id) must be set. Workspace-scoped.

CREATE TABLE public.interview_references (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  topic_id      uuid REFERENCES public.topic_backlog(id) ON DELETE CASCADE,
  interview_id  uuid REFERENCES public.interviews(id) ON DELETE CASCADE,
  url           text NOT NULL,
  title         text,
  notes         text,
  use_as_source boolean NOT NULL DEFAULT false,
  added_by      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interview_references_owner_chk
    CHECK ((topic_id IS NOT NULL)::int + (interview_id IS NOT NULL)::int = 1)
);

CREATE INDEX interview_references_topic_idx
  ON public.interview_references (workspace_id, topic_id)
  WHERE topic_id IS NOT NULL;

CREATE INDEX interview_references_interview_idx
  ON public.interview_references (workspace_id, interview_id)
  WHERE interview_id IS NOT NULL;

CREATE TRIGGER update_interview_references_updated_at
  BEFORE UPDATE ON public.interview_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_references TO service_role;
