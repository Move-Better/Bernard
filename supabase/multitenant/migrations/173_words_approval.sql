-- Phase 3 of the story-monitor redesign (.claude/story-monitor-redesign-plan.md).
-- The keystone gate: a story's words must be explicitly approved before ANY
-- of its pieces can publish/schedule/retry. Enforced server-side in the
-- publish handlers (api/_lib/wordsApprovalGate.js).
--
-- Backfill runs in the SAME migration as the ALTER, before any gate code
-- ships, so a pre-existing story with an already-approved/published piece
-- isn't retroactively locked out of publishing (see the plan doc's ordering
-- note). Picks, per interview, the EARLIEST piece that ever reached
-- approved/scheduled/published as the implicit "someone already reviewed
-- this" signal — falling back through published_at/scheduled_at/created_at
-- when approved_at is null (some historical rows never had it set), and to a
-- literal 'backfill-2026-07-11' marker when approved_by is null.
ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS words_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS words_approved_by text;

UPDATE public.interviews i
SET words_approved_at = sub.derived_at,
    words_approved_by = COALESCE(sub.approved_by, 'backfill-2026-07-11')
FROM (
  SELECT DISTINCT ON (interview_id)
    interview_id,
    approved_by,
    COALESCE(approved_at, published_at, scheduled_at, created_at) AS derived_at
  FROM public.content_items
  WHERE status IN ('approved', 'scheduled', 'published')
    AND interview_id IS NOT NULL
  ORDER BY interview_id, COALESCE(approved_at, published_at, scheduled_at, created_at) ASC
) sub
WHERE i.id = sub.interview_id
  AND i.words_approved_at IS NULL;
