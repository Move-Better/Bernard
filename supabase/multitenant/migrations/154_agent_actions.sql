-- 154 — agent_actions: the Standing Producer's append-only workday ledger.
--
-- Phase 0 of the Standing Producer (see .claude/standing-producer-sprint.md).
-- Every meaningful thing the system already does on a workspace's behalf —
-- a draft scored, the week planned, a post published or failed — is recorded
-- here as one row, and rendered back as "Bernard's workday" (the /producer
-- feed + the /week strip). Phase 0 only NARRATES existing events; later phases
-- add rows for autonomous actions (revisions, pre-drafts) against the same
-- table, so observability and the product surface share one ledger.
--
-- Writes are gated on workspaces.producer_config.enabled (migration 155) — a
-- workspace that hasn't hired Bernard gets zero rows. `kind` is deliberately
-- free text (not a CHECK): the vocabulary grows every phase, and a CHECK would
-- force a migration per new action type.
--
-- Token columns land now (even though Phase 0 records no LLM spend of its own)
-- so the /usage + /admin wiring in Phase 4 is a query, not a migration.

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor           text NOT NULL DEFAULT 'bernard',
  kind            text NOT NULL,
  title           text NOT NULL,
  detail          jsonb,
  content_item_id uuid,
  atom_id         uuid,
  interview_id    uuid,
  package_id      uuid,
  inbox_item_id   uuid,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_actions_ws_time
  ON public.agent_actions (workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_actions TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
