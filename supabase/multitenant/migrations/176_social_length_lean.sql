-- Content length-lean dial: how much depth Bernard writes into social posts.
-- Read (via the workspaces row, select=*) by api/_lib/socialLengthTargets.js in
-- BOTH generation paths — atomPrompts.js and briefPrompts.js. The dial scales
-- the long-lane (deep-dive) posts and leaves short hooks/CTAs alone.
-- Values: punchy | balanced | indepth. Default balanced.
--
-- workspaces is an existing table already GRANTed to service_role, so no new
-- grant is needed here.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS social_length_lean text NOT NULL DEFAULT 'balanced';

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_social_length_lean_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_social_length_lean_check
  CHECK (social_length_lean IN ('punchy', 'balanced', 'indepth'));

-- Move Better ships on in-depth — depth is its signature (Q, 2026-07-16).
UPDATE public.workspaces SET social_length_lean = 'indepth' WHERE slug = 'movebetter';
