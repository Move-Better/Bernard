-- 199_moments_retire_reasons.sql
-- Capture WHY a moment was retired, not just that it was. A reject is a
-- stronger signal than an approve (Q, 2026-07-30): approving mostly means
-- "no reason to say no yet", while a retire means the quote genuinely
-- doesn't land or wouldn't work on social — that's worth recording so a
-- future pass can act on it. This migration only captures the signal;
-- nothing reads it back into extraction or ranking yet (deferred until
-- there's real reject volume to calibrate against).
--
-- Same shape as content_items.model_reasons/model_note (the "good post"
-- signal, src/lib/modelRating.js): a fixed, shared reason vocabulary the
-- client renders as chips + free text, server-validated, plain text[] so
-- growing the set later needs no migration.
--
-- Deliberately NOT cleared on Restore — the "why didn't this land" signal
-- stays valid even if a human reconsiders this specific instance later.

ALTER TABLE public.moments
  ADD COLUMN IF NOT EXISTS retire_reasons text[],
  ADD COLUMN IF NOT EXISTS retire_note text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moments TO service_role;
