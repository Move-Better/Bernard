-- Durable storage for in-app feedback submissions (FeedbackWidget → POST
-- /api/feedback). Previously this route was email-only via Resend with no
-- persistence — a misconfigured recipient or a silent Resend failure meant
-- submitted screenshots were unrecoverable. This table makes the DB insert
-- the source of truth; email is now best-effort delivery on top of it.

CREATE TABLE IF NOT EXISTS public.feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid REFERENCES public.workspaces(id),
  user_id        text,
  user_name      text,
  user_email     text,
  message        text NOT NULL,
  screenshot_url text,
  page_url       text,
  notify_ok      boolean,
  notify_error   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_workspace_id_idx ON public.feedback (workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO service_role;
