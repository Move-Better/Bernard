-- 209 — close the interview-outputs fan-out duplicate-row race.
--
-- api/_routes/db/interviews.js fans interviews.outputs out into content_items,
-- guarded per-platform by a READ of the interview's existing platforms followed
-- by an INSERT of the missing ones. Two concurrent completion PATCHes (a
-- double-submit, two tabs, a retried webhook) can both read "blog is missing"
-- and both insert it. Application code cannot close that window; only the
-- database can.
--
-- WHY THE INDEX IS PARTIAL, AND WHY EACH PREDICATE IS LOAD-BEARING
-- ---------------------------------------------------------------
-- A blanket unique (interview_id, platform) is WRONG here and would fail to
-- build at all. Measured against production before writing this migration,
-- 40 (interview_id, platform) groups already hold more than one row:
--
--   instagram  15 groups (46 rows, worst 5)   ┐ the on-demand content plan;
--   linkedin   11 groups (29 rows, worst 4)   │ many posts per interview is
--   facebook    7 groups (16 rows, worst 3)   │ the whole point of the planner
--   gbp         6 groups (13 rows, worst 3)   ┘
--   blog        1 group  ( 4 rows, worst 4)   ← split-into-series parts
--
-- So each predicate excludes a different real, legitimate producer:
--
--   • platform IN (…the six fan-out platforms…) excludes the 39 content-plan
--     groups. Those rows come from content_plan_atoms, never from the fan-out;
--     OUTPUT_PLATFORM_MAP (api/_lib/interviewOutputFanout.js) deliberately
--     omits them for exactly this reason. Keep this list in step with that map.
--   • series_id IS NULL excludes the blog group. split-into-series
--     (api/_routes/content-items/split-into-series.js) inserts N blog rows
--     sharing one interview_id, each carrying a non-null series_id. The
--     fan-out never sets series_id.
--
-- Within the remaining scope (26 rows at time of writing) there are ZERO
-- duplicate groups, so this builds clean.
--
-- Note the insert side must now tolerate 23505 as success-by-another-writer —
-- PostgREST's `on_conflict=` cannot infer a PARTIAL index (it takes column
-- names only, with no way to supply the index predicate), so the fan-out
-- inserts one platform at a time and treats a unique violation as "someone
-- else already materialised this platform," which is precisely the outcome the
-- guard wanted anyway.

-- Plain (not CONCURRENTLY): content_items is 166 rows / 1.7 MB, so the build is
-- instant and the brief lock is irrelevant — and CONCURRENTLY cannot run inside
-- the transaction the migration tooling wraps this in.
create unique index if not exists content_items_fanout_uniq
  on public.content_items (interview_id, platform)
  where series_id is null
    and interview_id is not null
    and platform in ('blog', 'google_ads', 'landing_page', 'youtube', 'email', 'instagram_ads');

-- No GRANT needed: an index carries no privileges of its own — it is enforced
-- under the table's existing grants (see 003_grant_service_role.sql).
