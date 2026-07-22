-- 182_cadence_policy_day_time.sql
--
-- T4 learning loop, part 3 — day/time cadence learning. Documents two new
-- keys inside the existing workspaces.cadence_policy JSONB column (migration
-- 140). No ALTER TABLE / backfill needed — both keys default cleanly to
-- empty/absent in code (api/_lib/cadenceAdaptive.js, api/_lib/strategistPlan.js,
-- api/_routes/workspace/me.js), matching how `timezone` was added in 141.
--
-- New keys (both under cadence_policy, alongside version/provenance/
-- trust_stage/quiet_days/channels/digests/goals — see 140's contract comment):
--   day_time_proposal    jsonb|null   { day, sampleCount, avgScore,
--                                       baselineAvgScore, baselineCount,
--                                       computed_at }. Written ONLY by the
--                                       server (strategistPlan.js
--                                       maybeProposeDayChange, service-role
--                                       PATCH) once a currently-quiet day's
--                                       exploration data clears the sample
--                                       floor. The client (Settings → Channels
--                                       → Cadence CadenceCard) may only clear
--                                       it via Accept/Dismiss — never set
--                                       content (enforced in workspace/me.js
--                                       sanitizeCadencePolicy).
--   day_time_dismissed   text[]       3-letter day codes Q has explicitly
--                                     said to keep quiet — permanently
--                                     excluded from applyExplorationSlots()'s
--                                     weekly rotation. Client-editable via the
--                                     existing PATCH /api/workspace/me path.

comment on column public.workspaces.cadence_policy is
  'F1+F2 cadence governance. channels keyed by atom-platform id (instagram/linkedin/gbp/…); digests for email/newsletter; day_time_proposal + day_time_dismissed are T4 learning-loop additions (see api/_lib/cadenceAdaptive.js). NULL = workspace not yet onboarded to cadence governance (Strategist uses hardcoded fallback).';
