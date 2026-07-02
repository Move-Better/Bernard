-- Phase 2 (evolving interviewer): per-clinician interview-style ledger.
--
-- Stores which lead tactics / clinical angles / register the last few interviews
-- used, so the next interview can reach for fresh tactics and open at the right
-- level. Written by api/_lib/interviewStyleClassifier.js on interview completion;
-- read by the prompt builder (buildStyleMemoryBlock in src/lib/interviewTactics.js).
--
-- Shape: { sessions: [{ interviewId, tactics: [leadId], angles: [text], register, at }],
--          registerCeiling: 'lay'|'mid'|'peer', sessionCount: int }

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS interview_style_memory jsonb NOT NULL DEFAULT '{}'::jsonb;

-- staff already carries service_role grants (003_grant_service_role.sql); a new
-- column inherits the table-level grant, so no additional GRANT is required.
