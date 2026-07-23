-- 186_feedback_resolved.sql
--
-- Closes the loop on in-app feedback: adds "resolved" state so a reporter
-- (e.g. front-desk staff who submitted a bug via the Feedback button) can be
-- told their issue is fixed, instead of silently guessing whether it's safe
-- to go back to using the app.
--
--   resolved_at          — timestamptz, set when a fix for this report has shipped.
--   resolved_note        — short human note on what was fixed (e.g. a PR link/summary).
--   resolved_notified_at — timestamptz, set once the reporter's email notification
--                          was attempted (best-effort; not a delivery guarantee).
--   acknowledged_at       — timestamptz, set when the reporter has seen and dismissed
--                          the in-app "fixed" banner. Distinct from resolved_notified_at
--                          so the banner keeps showing even if the email never sent.
--
-- All nullable, default NULL (= unresolved / not yet acknowledged).

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS resolved_at          timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_note         text,
  ADD COLUMN IF NOT EXISTS resolved_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at       timestamptz;

-- "Give me this user's unseen fixed-notices" is the banner's hot query — keep it cheap.
CREATE INDEX IF NOT EXISTS feedback_unacked_resolved_idx
  ON public.feedback (user_id, resolved_at)
  WHERE resolved_at IS NOT NULL AND acknowledged_at IS NULL;

-- feedback already grants to service_role from its own migration; re-assert for safety.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO service_role;
