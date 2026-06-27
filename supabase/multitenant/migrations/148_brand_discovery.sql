-- Brand discovery interview (F5 prerequisite). A structured ~7-question voice
-- interview the founder runs to DERIVE the practice's brand identity — the
-- felt-sense brief (territory / not-this / emotional promise / the tension /
-- visual anchors) that later locks AI image generation to the brand.
--
-- Mirrors workspace_onboarding_interviews exactly in shape (same voice shell,
-- same pause/resume/synthesize lifecycle). A SEPARATE table because the output
-- is a brand brief, not voice/topics/phrases — keeping them apart means neither
-- synthesizer needs a type filter bolted onto every read.

CREATE TABLE IF NOT EXISTS public.brand_discovery_interviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Founder's Self-staff row. Nullable + SET NULL so deleting the staff row
  -- preserves the transcript. (Kept for parity/audit; the brand synthesizer
  -- writes to the workspace, not to a staff row.)
  staff_id           uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  -- Clerk user_id of the founder who ran the interview. Owner-only PATCH check
  -- on top of workspace-org gating.
  owner_id           text NOT NULL,
  -- Full transcript: [{ role: 'user'|'assistant', content: string }, ...]
  messages           jsonb NOT NULL DEFAULT '[]',
  -- Pause-resume blob (mirrors public.interviews / workspace_onboarding_interviews).
  session_state      jsonb,
  -- in_progress  — interview running
  -- completed    — INTERVIEW_COMPLETE detected; awaiting synthesis
  -- synthesizing  — atomic-claim in flight (race fence; see synthesize handler)
  -- synthesized  — brief written to workspaces.brand_brief
  -- abandoned    — explicit throwaway / superseded by a retake
  status             text NOT NULL DEFAULT 'in_progress'
                       CHECK (status IN ('in_progress','completed','synthesizing','synthesized','abandoned')),
  -- Synthesizer's structured output, for audit + replay.
  synthesis_result   jsonb,
  completed_at       timestamptz,
  synthesized_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Workspace-scoped lookup is the only query shape ("does this workspace have a
-- non-abandoned brand interview?"). Partial index skips abandoned rows.
CREATE INDEX IF NOT EXISTS brand_discovery_interviews_workspace_idx
  ON public.brand_discovery_interviews (workspace_id, status)
  WHERE status != 'abandoned';

-- The derived brand brief lives on the workspace so every content/image path
-- can read it without a join. Shape:
--   { territory: string[3], notThis: string[], emotionalPromise: string,
--     tension: string, visualAnchors: [{reference, why}],
--     model, prompt_version, synthesized_at }
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS brand_brief jsonb;

-- Service-role grants — the REST API used by serverless functions runs as
-- service_role; without these the route returns 403 / SQLSTATE 42501.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_discovery_interviews TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
