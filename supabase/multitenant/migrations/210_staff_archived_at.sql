-- staff.archived_at — hide a staff row from clinician-facing prompts without
-- deleting it.
--
-- Motivation (Q, 2026-08-11): Home's attention strip reported "7 overdue" for
-- Move Better, and two of those seven were e2e test fixtures ("E2E Smoke
-- Clinician" and "e2e"). A COUNT hid them; the new attention queue names every
-- row, so they became glaringly visible. The honest number for a human was 5.
--
-- Deleting them is not an option: staff.id is a foreign key in 13 tables, five
-- of them ON DELETE CASCADE, so a delete silently destroys interviews, voice
-- phrases and practice-memory chunks (see CLAUDE.md, "Deleting or merging a
-- staff row"). Archiving is the non-destructive equivalent.
--
-- SCOPE, deliberately narrow: today this column is read by exactly one place,
-- src/lib/attentionItems.js (isHiddenStaff), which drops archived people from
-- the "slipping" tier. It is NOT yet a general-purpose soft delete — an
-- archived person still appears in the staff list, the interview picker and
-- Stories. Widening it is a separate decision; this migration only claims what
-- it actually does.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.staff.archived_at IS
  'When set, this person is excluded from Home''s attention queue (test fixtures, departed staff). Not a general soft delete — see migration 210.';

-- Partial index: every read is "the NOT-archived ones", so only the archived
-- rows need indexing and the index stays tiny.
CREATE INDEX IF NOT EXISTS staff_archived_at_idx
  ON public.staff (workspace_id)
  WHERE archived_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO service_role;
