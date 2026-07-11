-- 169_answer_voice_fidelity.sql
-- F16 Phase 1 — voice-fidelity HARD GATE on public answers.
--
-- Mirrors content_items' voice columns (103_content_items_voice_audit.sql). Every
-- answer draft is scored against the owning clinician's captured voice + topic-scoped
-- practice memory before it can go live on movebetter.co with their name on it.
-- voice_audit.gate ('passed'|'held'|'unscored') blocks the approve->publish transition
-- at the API layer when it is not 'passed' — a low-fidelity public medical answer must
-- not publish. See api/_lib/scoreAnswerFidelity.js + api/_routes/answers.js.
--
-- No new object (ALTER ... ADD COLUMN on an existing table) -> answers' existing
-- GRANT (159_answers.sql) already covers service_role. Additive + idempotent.

ALTER TABLE public.answers
  ADD COLUMN IF NOT EXISTS voice_fidelity_score smallint,   -- 0-100 (overall*10), null until scored
  ADD COLUMN IF NOT EXISTS voice_audit          jsonb;      -- { said_fidelity, voice_match, safety, red_flag, gate, attempts, scored_at, model }
