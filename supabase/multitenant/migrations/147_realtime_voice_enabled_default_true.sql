-- Migration 147: Flip realtime_voice_enabled default to true
--
-- Phase: F1-A2
--
-- The flag started as default false to avoid billing surprises on external
-- tenant onboarding. All current workspaces are internal (Move Better);
-- enabling the feature broadly lets the weekly-call flow work without a
-- per-workspace ops step. External tenants self-onboard through /onboard,
-- which already sets the flag via claim.js — the code check in
-- api/realtime-session.js remains so any workspace explicitly set to false
-- is still blocked.

ALTER TABLE public.workspaces
  ALTER COLUMN realtime_voice_enabled SET DEFAULT true;

-- Enable all existing workspaces so no one is left behind the gate.
UPDATE public.workspaces
   SET realtime_voice_enabled = true
 WHERE realtime_voice_enabled = false;
