-- 179_atom_format_dimension.sql
--
-- T2 (reel spine) — give the planner a FORMAT dimension.
--
-- Until now an atom was (platform × angle × slot) only. There was no way to say
-- "this Instagram slot is a Reel, that one is a carousel": ATOM_DEFINITIONS has
-- no format field, and atomPlatformsFromEnabledOutputs() collapses the
-- instagram_post and instagram_reel output ids onto one `instagram` key. The
-- consequence is visible in prod — zero instagram_reel content_items have ever
-- existed, while 217 source videos and 165 unrendered moments sit in the
-- Library.
--
-- Three changes:
--
-- 1. `format` — the plannable output format for the slot. Vocabulary:
--        'post'  — single image / text post (the historical default)
--        'reel'  — short vertical video (Instagram Reel, TikTok, Shorts)
--        'story' — 9:16 ephemeral frame (instagram_story)
--    Deliberately NO CHECK constraint, matching 178_media_render_status.sql: a
--    CHECK on a vocabulary column means every new format needs a migration
--    lock-stepped with the code that emits it. NULL means 'post' so every
--    pre-existing row keeps its exact meaning without a backfill.
--
-- 2. `interview_id` becomes NULLABLE. A reel atom's source is a media_assets
--    video + a video_segments moment — there is no interview behind it
--    (neither table carries an interview_id). Every existing reader already
--    guards for this rather than assuming a value:
--        api/_routes/content-plan/draft.js:64      -> 422 'no linked interview'
--        api/_lib/producer/predraftWeek.js:80      -> skipped, reason no_interview
--        api/_lib/producer/predraftWeek.js:251     -> filters interview_id=not.is.null
--        api/_routes/content-plan/{atoms,channel}.js -> filter BY interview_id,
--            so a reel atom correctly does not appear in a story's channel set.
--    Reel atoms are born status='drafted' with content_piece_id already set, so
--    they never enter the draft/predraft paths those guards protect.
--
-- 3. `source_segment_id` — pointer (NOT a FK) to the video_segments moment a
--    reel atom was cut from, so the auto-reel worker can tell "already drafted
--    this moment" from "never drafted it" without string-matching notes. A bare
--    pointer, matching the source_asset_id/source_piece_id precedent in
--    migration 116: deleting a moment must not cascade away a shipped reel.

ALTER TABLE public.content_plan_atoms
  ADD COLUMN IF NOT EXISTS format            text,
  ADD COLUMN IF NOT EXISTS source_segment_id uuid;

ALTER TABLE public.content_plan_atoms
  ALTER COLUMN interview_id DROP NOT NULL;

COMMENT ON COLUMN public.content_plan_atoms.format IS
  'Plannable output format: post | reel | story. NULL = post (pre-format rows).';
COMMENT ON COLUMN public.content_plan_atoms.source_segment_id IS
  'video_segments.id this atom was cut from (reel atoms). Pointer only, no FK.';

-- The auto-reel worker''s hot query: "which reel slots does this workspace
-- already have for this week?" and "have I drafted this moment before?"
CREATE INDEX IF NOT EXISTS content_plan_atoms_ws_week_format_idx
  ON public.content_plan_atoms (workspace_id, plan_week, format);
CREATE INDEX IF NOT EXISTS content_plan_atoms_source_segment_idx
  ON public.content_plan_atoms (source_segment_id)
  WHERE source_segment_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_plan_atoms TO service_role;
