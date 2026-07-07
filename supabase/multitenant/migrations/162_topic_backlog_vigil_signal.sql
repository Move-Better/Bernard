-- Widen topic_backlog.source to accept an external 'vigil_signal' provenance,
-- and add an idempotency_key so a replayed external suggestion doesn't create a
-- duplicate row.
--
-- Backs the generic topic-suggestion inbox POST /api/webhooks/topic-signal
-- (contract signals-in.v1). Additive and safe: existing rows keep their source;
-- 'vigil_signal' is only ever written by that authenticated inbox, which is
-- inert (503) until VIGIL_SIGNAL_SECRET is set. Ship-dark — no rush to apply.

-- The inline CHECK from 024_topic_backlog.sql is auto-named
-- topic_backlog_source_check. Drop and re-add with the new value included.
ALTER TABLE public.topic_backlog
  DROP CONSTRAINT IF EXISTS topic_backlog_source_check;

ALTER TABLE public.topic_backlog
  ADD CONSTRAINT topic_backlog_source_check
  CHECK (source IN ('manual', 'ai_suggested', 'vigil_signal'));

-- Idempotency key from the external caller. NULL for manual / ai_suggested rows.
ALTER TABLE public.topic_backlog
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- A replayed (workspace_id, idempotency_key) must not create a second row.
-- Partial unique index — only external suggestions carry a key; manual/ai rows
-- leave it NULL and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS topic_backlog_workspace_idempotency_key_idx
  ON public.topic_backlog (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
