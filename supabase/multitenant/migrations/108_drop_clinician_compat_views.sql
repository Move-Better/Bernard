-- 108_drop_clinician_compat_views.sql
--
-- Phase 4 part 2 (clinician → staff rename, final cleanup).
--
-- Migration 106 renamed the four roster tables to staff/staff_recipes/
-- staff_voice_phrases/staff_corpus_documents and left backward-compat VIEWS
-- behind the OLD names so code referencing `.from('clinicians')` etc. kept
-- working during the cutover window.
--
-- All code now reads/writes the staff tables directly (verified: the acceptance
-- grep `from('clinicians')|'clinicians'|/api/db/clinicians|/api/clinicians`
-- returns 0 across src/api/scripts/tests, and the only re-runnable raw SQL —
-- the E2E seed and the merge-* dev scripts — was updated to `staff`). Drop the
-- compat views.
--
-- Idempotent (IF EXISTS). No grants needed for DROP. Transactional.

BEGIN;

DROP VIEW IF EXISTS public.clinicians;
DROP VIEW IF EXISTS public.clinician_recipes;
DROP VIEW IF EXISTS public.clinician_voice_phrases;
DROP VIEW IF EXISTS public.clinician_corpus_documents;

COMMIT;
