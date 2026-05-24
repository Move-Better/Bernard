-- Phase 5 Feature 4 — patient handouts capture lane.
--
-- A clinician records a 30–60s voice memo after a patient encounter
-- ("I just saw Karen, post-op shoulder, gave her three exercises…"),
-- NarrateRx transcribes it and generates a personalized handout in
-- the clinician's voice. Printed in-clinic, emailed later (PR3), or
-- read aloud via the voice clone (PR4).
--
-- Capture surface uses the existing voice-memo blob + Whisper pipeline,
-- but tagged with a new capture_mode so the generation path produces a
-- handout (single content_item with platform='handout') instead of a
-- blog draft.
--
-- Workspace flag gates the entry point — default off, on only for
-- workspaces actively dogfooding the feature.

-- 1. Extend the capture_mode check constraint to allow 'patient_handout'.
--    Mirror the drop-then-add pattern used by 067/068/069.
alter table public.interviews
  drop constraint if exists interviews_capture_mode_check;

alter table public.interviews
  add constraint interviews_capture_mode_check
    check (capture_mode in (
      'interview',
      'voice_memo',
      'seminar',
      'text_import',
      'realtime_voice',
      'patient_handout'
    ));

-- 2. Workspace-level enablement flag. Same shape as realtime_voice_enabled.
alter table public.workspaces
  add column if not exists patient_handouts_enabled boolean not null default false;

-- Service-role already has the grants on workspaces / interviews from
-- earlier migrations; nothing new to grant here.
