-- 172_topic_backlog_idempotency_and_vigil_source.sql
--
-- Fixes topic_backlog so the generic signed inbox api/_routes/webhooks/topic-signal.js
-- can actually insert. That endpoint was written against a schema that never shipped:
-- it inserts an `idempotency_key` column (missing) and source='vigil_signal' (excluded
-- by the source CHECK), so every insert 500'd — the endpoint had never succeeded until
-- the movebetter.co homepage concierge became its first real caller (gap questions →
-- "flagged for our doctors" → topic_backlog).
--
-- Additive + idempotent: adds a nullable column, widens the source CHECK, adds the
-- partial unique index the endpoint's idempotency/409 handling relies on.
--
-- Applied to prod 2026-07-11 via Supabase MCP; committed here for the record + the
-- schema-drift snapshot.

ALTER TABLE public.topic_backlog ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.topic_backlog DROP CONSTRAINT IF EXISTS topic_backlog_source_check;
ALTER TABLE public.topic_backlog ADD CONSTRAINT topic_backlog_source_check
  CHECK (source = ANY (ARRAY['manual', 'ai_suggested', 'vigil_signal']));

CREATE UNIQUE INDEX IF NOT EXISTS topic_backlog_idem_uniq
  ON public.topic_backlog (workspace_id, source, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
