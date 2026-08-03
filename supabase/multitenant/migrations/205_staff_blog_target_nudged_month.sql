-- Per-clinician watermark for the 1-blog-per-month nudge (Q, 2026-08-01).
--
-- Holds the YYYY-MM the clinician was last nudged about being short of their
-- blog target. Stamped by api/_routes/cron/blog-target-nudge.js on exactly the
-- rows that were actually emailed, so a re-run inside the same month is a no-op
-- rather than a second email.
--
-- Why a column on staff rather than an agent_actions row: recordAgentAction()
-- is gated on the workspace's producer config being enabled and silently
-- returns { skipped } when it is not. A cooldown that depends on it would fail
-- OPEN — the watermark would never be written and every clinician short of
-- target would be emailed once a day for the rest of the month. A stamp on the
-- person's own row cannot fail open, and mirrors the moment-sendback nudge,
-- which stamps sent_back_notified_at on exactly the rows it emailed.
--
-- Text (YYYY-MM), not a timestamp: the question is "which MONTH did we already
-- nudge this person about", and comparing month keys directly avoids re-deriving
-- a month from a timestamp in the workspace's timezone at every read.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS blog_target_nudged_month text;

COMMENT ON COLUMN public.staff.blog_target_nudged_month IS
  'YYYY-MM of the last blog-target nudge sent to this clinician. One nudge per person per month; see api/_routes/cron/blog-target-nudge.js.';

-- No GRANT needed: privileges on public.staff are table-level and service_role
-- already holds them (migration 003). A new column inherits them.
