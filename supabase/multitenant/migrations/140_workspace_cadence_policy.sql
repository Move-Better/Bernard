-- Migration 140: workspaces.cadence_policy — per-workspace cadence governance (F1+F2).
--
-- The cadence_policy JSONB column is the shared contract between F1 (input side,
-- this session) and F2 (the Strategist/output side). F1 owns the write-path;
-- F2 reads channels + quiet_days to compose the weekly plan.
--
-- Schema contract (exact shape — the F2 Strategist reads this):
--   version       int      semver for forward-compat
--   provenance    text     'bernard' (recommended) | 'user' (edited)
--   trust_stage   text     'approve_all' | 'approve_exception' | 'manage_by_goals'
--   quiet_days    text[]   3-letter day codes excluded from scheduling
--   channels      jsonb    keyed by ATOM-PLATFORM id (instagram, linkedin, gbp,
--                          facebook, tiktok, twitter, threads, bluesky,
--                          instagram_story). NOT output-registry ids (instagram_post etc).
--                          Value: { target_per_week: int, enabled: bool }
--   digests       jsonb[]  assembled multi-feed (email/newsletter). The Strategist
--                          ignores digests; they are F1 read + future digest-assembler.
--   goals         jsonb[]  future (manage_by_goals stage)
--
-- IMPORTANT: blog, email, newsletter are NOT in channels. They are single-output /
-- digest outputs and belong in digests[]. The Strategist plans in the
-- atom-platform namespace only.
--
-- Default seed = the signed-off proposed-week mockup (Q 2026-06-21):
--   instagram×4 + linkedin×3 + gbp×3 per week; Patients email digest monthly.
--   facebook/tiktok/twitter/threads/bluesky/instagram_story default absent
--   (enabled:false by omission; the Strategist treats absent as disabled).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS cadence_policy jsonb;

COMMENT ON COLUMN public.workspaces.cadence_policy IS
  'F1+F2 cadence governance. channels keyed by atom-platform id (instagram/linkedin/gbp/…); digests for email/newsletter. NULL = workspace not yet onboarded to cadence governance (Strategist uses hardcoded fallback).';

-- Seed all existing workspaces that do not yet have a cadence_policy.
-- New workspaces get it from the onboarding INSERT (api/_routes/onboarding/claim.js).
UPDATE public.workspaces
SET cadence_policy = '{
  "version": 1,
  "provenance": "bernard",
  "trust_stage": "approve_all",
  "quiet_days": ["sat", "sun"],
  "channels": {
    "instagram": {"target_per_week": 4, "enabled": true},
    "linkedin":  {"target_per_week": 3, "enabled": true},
    "gbp":       {"target_per_week": 3, "enabled": true}
  },
  "digests": [
    {"id": "patients", "label": "Patients", "channel": "email",
     "frequency": "monthly", "enabled": true, "audience": "patients"}
  ],
  "goals": []
}'::jsonb
WHERE cadence_policy IS NULL;

-- No GRANT needed: workspaces already has full service_role grants from early migrations.
