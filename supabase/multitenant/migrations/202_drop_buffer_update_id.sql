-- 202_drop_buffer_update_id.sql — collapse the duplicate post-id column.
--
-- content_items carried TWO columns holding the same value: buffer_update_id
-- (the original, named for a provider retired 2026-07-30 in migration 201) and
-- platform_post_id (the neutral name added later). Every writer set both, so
-- they never diverged, but readers picked one arbitrarily — 21 files read
-- buffer_update_id, 3 read platform_post_id.
--
-- Prod at time of writing: 45 rows with buffer_update_id, 42 with
-- platform_post_id, all 42 identical, 0 differing, and 0 rows where only
-- platform_post_id is set. So platform_post_id carries no unique data and
-- buffer_update_id is the superset.
--
-- Direction: keep platform_post_id (the name that survives), backfill the
-- legacy rows into it, drop buffer_update_id.
--
-- Why backfill-then-drop rather than drop-platform_post_id-then-rename, which
-- would also work and needs no UPDATE: the rename creates a deploy-ordering
-- hazard. Between the code merge and the migration, new code writes only
-- platform_post_id; a later DROP of that column would discard exactly those
-- writes. Backfilling into the column the new code already uses means the
-- column new code depends on exists, and holds the right value, at every point
-- in the rollout. Ordering is still code-first (old code writes
-- buffer_update_id, which this migration removes), but no window loses data.

-- Guard: refuse to run if the two columns ever disagreed, since the backfill
-- below silently picks a winner. Re-checked here rather than trusted from the
-- read above, because rows can change between measuring and migrating.
DO $$
DECLARE conflicting int;
BEGIN
  SELECT count(*) INTO conflicting
    FROM public.content_items
   WHERE buffer_update_id IS NOT NULL
     AND platform_post_id IS NOT NULL
     AND buffer_update_id IS DISTINCT FROM platform_post_id;
  IF conflicting > 0 THEN
    RAISE EXCEPTION
      'content_items: % row(s) have buffer_update_id <> platform_post_id — resolve before collapsing',
      conflicting;
  END IF;
END $$;

-- Carry the legacy rows across. Scoped to rows platform_post_id would other-
-- wise lose; never overwrites a value already there.
UPDATE public.content_items
   SET platform_post_id = buffer_update_id
 WHERE platform_post_id IS NULL
   AND buffer_update_id IS NOT NULL;

ALTER TABLE public.content_items DROP COLUMN buffer_update_id;

COMMENT ON COLUMN public.content_items.platform_post_id IS
  'Provider post id for the published post (bundle.social). Absorbed the former buffer_update_id column in migration 202.';
