-- Prevents duplicate aspect-variant rows from a double-submit / retried
-- "Fit for carousel" request racing saveAspectVariant's find-then-insert
-- (api/_lib/aspectVariants.js). findAspectVariant (a SELECT) and the
-- subsequent INSERT are two separate round-trips with nothing tying them
-- together today; two near-simultaneous calls can both see `existing =
-- null` and both INSERT, leaving two media_assets rows with the same
-- (parent_id, variant_label) -- the "replace, don't accumulate" invariant
-- the code's own comments describe is only honored on the happy path, not
-- under a race. Found by /bernard-audit full (bug-hunter, P2) -- low
-- probability (single-user UI action, not a hot path) and non-destructive
-- (an extra row, not data loss), so this migration is PREPARED but NOT
-- applied to prod as part of that audit; apply manually once reviewed.
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_aspect_variant_unique
  ON public.media_assets (parent_id, variant_label)
  WHERE archived_at IS NULL AND variant_label IS NOT NULL;
