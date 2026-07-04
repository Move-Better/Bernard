-- 159_answers.sql
-- Public patient-answer library — system of record in Bernard, published to movebetter.co.
--
-- Each answer is owned by a clinician (their name is on it as medical advice) and moves
-- drafting -> needs_review -> (changes_requested <-> needs_review) -> approved -> published.
-- Bernard drafts grounded answers in the owning clinician's voice; the clinician reviews on
-- their Home queue and approves/edits; approval publishes to movebetter.co (QAPage schema).
--
-- staff_id is stored as a plain uuid (no FK) — matching 154_agent_actions — so this table
-- stays out of the merge_staff / cascade-repoint graph. The API validates it with UUID_RE
-- and scopes every read/write by workspace_id (API-layer tenant isolation).

CREATE TABLE IF NOT EXISTS public.answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  staff_id          uuid,                       -- owning clinician (staff.id): byline + review queue
  question          text NOT NULL,
  slug              text NOT NULL,
  answer_lead       text,                       -- direct ~40-60 word reply (QAPage acceptedAnswer)
  body              text,                       -- markdown depth prose
  condition         text,
  seo_title         text,
  summary           text,
  chat_prompts      jsonb,                      -- optional per-answer "Ask Move Better" starter prompts
  status            text NOT NULL DEFAULT 'needs_review'
                      CHECK (status IN ('drafting','needs_review','changes_requested','approved','published')),
  review_notes      text,                       -- clinician's revise request / edit note
  grounding_source  text,                       -- human-readable provenance ("from your interview X")
  source            text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('backfill','producer','manual')),
  published_at      timestamptz,
  movebetterco_slug text,                       -- slug on movebetter.co once published
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS answers_ws_status ON public.answers (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS answers_staff_queue ON public.answers (workspace_id, staff_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.answers TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Per-clinician opt-in to the answer-review queue on Home (mirrors staff.blog_review_enabled).
ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS answer_review_enabled boolean NOT NULL DEFAULT false;
