-- 170_answer_publish_enabled.sql
-- F16 Phase 2 — per-workspace go-live for the public answer library.
--
-- Replaces the global ANSWER_PUBLISH_ENABLED env flag with a per-tenant boolean.
-- An approved answer publishes to movebetter.co only when its workspace has this
-- set true AND it cleared the Phase 1 voice-fidelity gate AND a human approved it
-- (triple-gated). Defaults false — no workspace goes live until it's flipped
-- deliberately (movebetter first, then broadened after confirmation).
--
-- No new object (column on the existing workspaces table) -> workspaces' existing
-- GRANT already covers service_role. Additive + idempotent.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS answer_publish_enabled boolean NOT NULL DEFAULT false;
