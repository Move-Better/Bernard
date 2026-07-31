-- 200_moments_author_review.sql
-- "Send this back to whoever said it." The third verdict in the On-hand review
-- queue, alongside Approve and Retire (Q, 2026-07-30).
--
-- The gap it closes: a producer reviewing the bank can SEE that a quote is
-- garbled — ASR runs two clauses together, drops a word, mangles a term — but
-- cannot fix it, because only the person who said it knows what they meant.
-- Retiring it throws away a real idea over a transcription artifact; approving
-- it ships the garble. Neither is right, so this is its own verdict.
--
-- Distinct from migration 199's `transcription_error` retire reason: that one
-- records why a quote was KILLED. This one keeps the quote alive and routes it
-- to the one person who can repair it.
--
-- Held out of drafting while it waits (Q, 2026-07-30): momentPlan.js and
-- moments/summary.js both filter `sent_back_at is null`. A producer has said
-- the words are wrong, so composing a post from them would spend a real slot
-- on copy a human already rejected.
--
-- Cleared by an excerpt edit (db/moments.js): fixing the text IS the
-- resolution, and the moment returns to the normal unreviewed queue so the
-- producer still gets the final say. `sent_back_by` is a Clerk user id, same
-- as reviewed_by. `sent_back_notified_at` is the nudge-email watermark so the
-- daily cron can't re-mail the same backlog (same shape as
-- feedback.resolved_notified_at).

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS sent_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_back_by text,
  ADD COLUMN IF NOT EXISTS sent_back_note text,
  ADD COLUMN IF NOT EXISTS sent_back_notified_at timestamptz;

-- The author's "needs your fix" list and the nudge cron both read
-- (workspace, staff, pending) — partial index keeps it cheap as the bank grows.
CREATE INDEX IF NOT EXISTS moments_sent_back_idx
  ON public.moments (workspace_id, staff_id)
  WHERE sent_back_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO service_role;
