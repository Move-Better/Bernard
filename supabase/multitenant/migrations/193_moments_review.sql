-- 193_moments_review.sql
-- Moment review queue — the /moments "On hand" tab becomes a card-based
-- approval pass instead of a 133-row list nobody curates.
--
-- Review is a MARKER, not a gate. The planner keeps drawing from every banked
-- moment exactly as it does today (match_moments in 191 still filters on
-- status='banked' only) — approving does not change what publishes. What it
-- buys is (a) a finite queue so the whole bank actually gets a human verdict,
-- and (b) an audit stamp on the verdict.
--
-- Deliberately NOT backfilled: every existing moment starts unreviewed, which
-- is the truth — none of them have been looked at. A backfill would empty the
-- queue on day one and make the feature a no-op.
--
-- reviewed_by holds the Clerk user id (text), matching content_items.approved_by
-- (032) and interviews.words_approved_by (173); the client resolves it to a name
-- via staff.user_id the same way AssetsPane does.
--
-- Both verdicts stamp these columns:
--   Approve → reviewed_at/by set, status stays 'banked'  (kept, still usable)
--   Retire  → reviewed_at/by set, status flips 'retired' (no future draws)
-- so "who decided this, and when" reads the same for either outcome. Restore
-- leaves the stamp in place — a restored moment has been reviewed, so it must
-- not reappear in the queue.

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

-- The queue reads "banked AND unreviewed, strongest first". Partial index so it
-- stays cheap as the reviewed set grows past the pending set.
CREATE INDEX IF NOT EXISTS moments_pending_review_idx
  ON public.moments (workspace_id, score DESC NULLS LAST)
  WHERE reviewed_at IS NULL AND status = 'banked';

-- Existing table, but grants restated per the self-sufficient-migration rule.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO service_role;
