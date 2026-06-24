-- Migration 143: publish-failure surfacing (Option C, Phase 1).
--
-- Today a social post that bundle.social rejects (status=ERROR) is invisible
-- inside Bernard: the reconciliation cron sees the ERROR and deliberately
-- LEAVES the row at status='scheduled', so a failed post is indistinguishable
-- from one still waiting to go out. Phase 1 makes failures a real terminal
-- state the UI can show.
--
-- Modeling choice:
--   * status='failed' — content_items.status is free text with NO check
--     constraint (see migration 138), so the new value needs no DDL on status.
--   * publish_error — the human-readable reason bundle.social returned
--     (data.error / data.errorsVerbose), shown verbatim on the failed card and
--     in the failure email. NULL for every non-failed row.
--   * "detected at" reuses updated_at (it moves when the cron/webhook PATCHes
--     the row to failed) — no separate timestamp column.
--
-- No GRANT needed: content_items is an existing table already granted to
-- service_role (003_grant_service_role.sql); a new column inherits the table's
-- existing privileges.

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS publish_error text;

COMMENT ON COLUMN public.content_items.publish_error IS
  'Publish-failure surfacing: verbatim reason bundle.social returned when a post failed (status=failed). NULL when the post did not fail. Set by the sync-buffer-published cron and the bundle webhook; cleared on a successful retry.';
