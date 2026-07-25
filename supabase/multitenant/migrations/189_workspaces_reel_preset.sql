-- 189 — workspaces.reel_preset
--
-- The reel factory renders each moment with one of the looks in
-- api/_lib/reelPresets.js. Until now it ALWAYS rotated: pickReelPreset() read
-- ws.reel_preset, that column did not exist, so the value was always undefined
-- and the rotation branch always won. The pin was dead code.
--
-- NULL means "keep rotating" — the default, and what the learning period wants:
-- every look accrues real use so the one a human keeps is measurable. Setting a
-- value pins that look and ends the rotation for the workspace.
--
-- The CHECK mirrors REEL_PRESET_IDS in api/_lib/reelPresets.js. Adding a preset
-- there needs a matching migration here, or the new id is rejected on write —
-- deliberately, so the DB can never hold an id the renderer cannot resolve.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS reel_preset text;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_reel_preset_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_reel_preset_check
  CHECK (reel_preset IS NULL OR reel_preset IN ('captions_only', 'hook_card', 'kinetic', 'editorial'));

COMMENT ON COLUMN public.workspaces.reel_preset IS
  'Pinned reel look (api/_lib/reelPresets.js). NULL = rotate across all presets.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO service_role;
