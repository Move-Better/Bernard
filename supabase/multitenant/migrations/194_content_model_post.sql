-- A pre-publish, human craft judgment: "this composition came together well."
-- Distinct from `performed_well` (Tier 1 exemplar flag, set post-publish once
-- the audience responded). This one is available the moment a post is
-- perfected, before any audience has seen it, and feeds generation as a
-- "write more like this" example — see fetchTopExemplars in src/lib/exemplars.js.
--
-- model_reasons stores an array of reason KEYS from the fixed set in
-- src/lib/modelRating.js (MODEL_REASON_KEYS) — validated server-side in
-- api/_routes/db/content.js, not enforced by a DB constraint (the reason set
-- may grow without a migration).

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS is_model_post boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS model_reasons text[],
  ADD COLUMN IF NOT EXISTS model_note text,
  ADD COLUMN IF NOT EXISTS model_marked_at timestamptz;

-- Partial index mirroring content_items_performed_well_idx (020) — exemplar
-- reads filter by `is_model_post = true AND platform = ?` and the default
-- value matches the vast majority of rows.
CREATE INDEX IF NOT EXISTS content_items_model_post_idx
  ON public.content_items (workspace_id, platform, model_marked_at DESC)
  WHERE is_model_post = true;
