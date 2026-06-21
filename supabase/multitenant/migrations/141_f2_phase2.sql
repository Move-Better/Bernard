-- Migration 141: F2 Phase 2 — timezone in cadence_policy + blog_review_enabled on staff.
--
-- 1. timezone: the workspace local timezone for scheduling. assignSlots converts
--    BEST_HOUR (local) to UTC using this field. Defaults to America/Los_Angeles.
--    Stored in cadence_policy JSONB, not a separate column, since it is part of
--    the cadence governance contract.
--
-- 2. blog_review_enabled: per-clinician opt-in. When true, blog content_items
--    generated for that clinician start in 'in_review' so they route to the author
--    before the producer sees them. Default false = no change in behaviour.
--
-- No new tables: no GRANT blocks needed beyond what exists.

-- Add timezone to cadence_policy for workspaces that don't have it yet.
UPDATE public.workspaces
SET cadence_policy = cadence_policy || '{"timezone": "America/Los_Angeles"}'::jsonb
WHERE cadence_policy IS NOT NULL
  AND cadence_policy->>'timezone' IS NULL;

-- Add blog_review_enabled to staff.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS blog_review_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.staff.blog_review_enabled IS
  'F2 opt-in: when true, blog content_items generated for this clinician start in_review so they can approve their own blog copy before it reaches the producer.';
