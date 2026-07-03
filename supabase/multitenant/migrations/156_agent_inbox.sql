-- 156 — agent_inbox: the Standing Producer's durable work queue.
--
-- Phase 1 (see .claude/standing-producer-sprint.md). Sensors enqueue work here;
-- the agent-tick cron (every 5 min) claims pending items with optimistic
-- concurrency, dispatches by `kind`, and records the outcome. Continuity lives
-- in this table + the practice brain, not in a long-lived process — the
-- "persistent agent" is (durable state × frequent ticks × full-corpus grounding).
--
-- The schema is deliberately queue-shaped (dedupe_key, status, attempts,
-- claimed_at) so a future migration to Vercel Queues/Workflow is a consumer
-- swap, not a schema change.
--
-- `dedupe_key` + UNIQUE(workspace_id, dedupe_key) is the enqueue-idempotency
-- primitive: a sensor (or the tick's backfill scan) can fire the same event
-- twice and the queue holds exactly one row. Phase 1's only kind is
-- 'revise_content_item' (dedupe_key = 'change_request:'+comment_id).

CREATE TABLE IF NOT EXISTS public.agent_inbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  dedupe_key      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_item_id uuid,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'claimed', 'done', 'failed', 'skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  claimed_at      timestamptz,
  processed_at    timestamptz,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS agent_inbox_ws_status
  ON public.agent_inbox (workspace_id, status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_inbox TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
