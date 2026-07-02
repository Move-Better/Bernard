-- 153 — AI-citation tracking ("Are you the answer?").
--
-- The /seo citation scoreboard probes answer engines (ChatGPT web search,
-- Perplexity; Google pending a SERP/Gemini credential) with real patient
-- questions once a week and records whether the workspace's clinic is among
-- the cited sources. Two tables:
--
--   seo_tracked_questions — the per-workspace question set. Seeded
--     automatically by the probe cron from GSC queries + published topics
--     (source='auto'); editors can add ('manual') or deactivate. A question
--     queued as an interview coverage goal stamps goal_queued_at.
--
--   seo_citation_probes — one row per (question, engine, run). Readers take
--     the latest row per (question_id, engine); history stays for the trend
--     line (share this week vs last). Idempotent like gsc_query_snapshots:
--     a duplicate run appends timestamped rows, never corrupts.

CREATE TABLE IF NOT EXISTS public.seo_tracked_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  question       text NOT NULL,
  topic          text,
  source         text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual')),
  active         boolean NOT NULL DEFAULT true,
  goal_queued_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, question)
);

CREATE INDEX IF NOT EXISTS seo_tracked_questions_ws
  ON public.seo_tracked_questions (workspace_id, active);

CREATE TABLE IF NOT EXISTS public.seo_citation_probes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  question_id      uuid NOT NULL REFERENCES public.seo_tracked_questions(id) ON DELETE CASCADE,
  engine           text NOT NULL CHECK (engine IN ('chatgpt', 'perplexity', 'google')),
  cited            boolean NOT NULL DEFAULT false,
  cited_urls       jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_cited_domain text,
  answer_excerpt   text,
  probed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_citation_probes_ws_time
  ON public.seo_citation_probes (workspace_id, probed_at DESC);

CREATE INDEX IF NOT EXISTS seo_citation_probes_question
  ON public.seo_citation_probes (question_id, engine, probed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_tracked_questions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.seo_citation_probes TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
