-- 214_content_items_moment_provenance.sql
-- Durable moment provenance on the piece itself (P5 concordance).
--
-- Until now the ONLY link from a published piece back to its banked moment was
-- the ephemeral join content_plan_atoms.moment_id → content_plan_atoms
-- .content_piece_id. The planner deletes/recreates atoms, so the P5 concordance
-- cohort silently loses members every recycle (2026-08 outcome review § Week-4:
-- 31 → 21 surviving by 08-28). This stamps the moment straight onto the
-- content_items row at draft time.
--
-- moment_id — FK ON DELETE SET NULL: a piece must outlive its moment (moments
--   die with their interview via CASCADE; the piece is published inventory).
-- moment_provenance — jsonb frozen at draft time ({score, moment_type,
--   is_exemplar, cluster_id, anchored, stamped_at}). This is the half that
--   survives even the FK going null: when the interview (and so the moment) is
--   deleted, the concordance analysis still knows the draft-time score. It is
--   written ONLY by the two server draft paths (draft.js / predraftWeek.js) —
--   deliberately absent from the client PATCH allowlist in db/content.js.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS moment_id uuid REFERENCES public.moments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moment_provenance jsonb;

CREATE INDEX IF NOT EXISTS content_items_moment_idx
  ON public.content_items (moment_id);

-- No new GRANT needed: content_items already carries table-level
-- SELECT/INSERT/UPDATE/DELETE for service_role, which covers new columns.
