-- Migration 208: point-content safety audit on content_items
--
-- Phase 2b of "Make a point" (.claude/make-a-point-spec.md) — the advisory
-- safety-flag chip. A SEPARATE axis from voice_fidelity_score/voice_audit
-- (migration 103): that pair judges whether a draft sounds like the
-- clinician; this pair judges whether a point-content draft overclaimed a
-- mechanism as established fact or crossed into reader-directed instruction,
-- per the GENERAL TEACHING vs INDIVIDUAL INSTRUCTION line
-- (api/_lib/generalTeachingVsIndividualInstruction.js). Deliberately its own
-- columns, not folded into voice_audit — conflating two unrelated judgments
-- into one column is exactly the validator drift this codebase has been
-- burned by before.
--
-- Only ever populated for long-form content generated from a kind='point'
-- interview (see api/_lib/pointContentFraming.js for why short-form has no
-- mechanism-claim surface to check). NULL for every other content_item.

ALTER TABLE public.content_items
  -- 0-100; higher = held the framing better. NULL until audited, or for any
  -- content_item this check never applies to.
  ADD COLUMN IF NOT EXISTS point_safety_score smallint,
  -- { gate:'passed'|'held'|'unscored', threshold, red_flag, model, audited_at }
  -- or { gate:'unscored', error } if a pass failed. NULL until audited.
  ADD COLUMN IF NOT EXISTS point_safety_audit jsonb;

CREATE INDEX IF NOT EXISTS idx_content_items_point_safety
  ON public.content_items (workspace_id, point_safety_score)
  WHERE point_safety_score IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO service_role;
