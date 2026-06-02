-- Phase 8 — AI learns from clinician edits.
--
-- Adds a `source` column to staff_voice_phrases so phrases captured from
-- direct editor saves can be distinguished from approval-path phrases.
-- Values: 'approval' (existing), 'edit' (new, from editorial save).
-- Nullable so existing rows don't break (treated as legacy/approval).

ALTER TABLE public.staff_voice_phrases
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.staff_voice_phrases.source IS
  'How this phrase entered the library: ''approval'' = captured on clinician approval/voice-training, ''edit'' = captured from a direct editor save (Phase 8).';
