-- 146_voice_clone_opt_out.sql
--
-- Self-serve "do not clone my voice" lock. When a staff member turns this on,
-- Bernard must never create or use an audio voice clone for them:
--   - voice_clone_opt_out = true blocks /api/voice-clone/create + /resume
--   - turning it on auto-revokes any existing clone (nulls eleven_voice_id,
--     sets voice_clone_revoked_at) — handled in api/_routes/voice-clone/opt-out.js
--   - tts.js / voice/pre-visit.js skip the clone when this is true (defense in depth)
--
-- Reversible: turning it back off clears the flag and re-enables training.
-- The written voice model (signature phrases, voice_notes) is unaffected — this
-- governs the ElevenLabs audio clone only.
--
-- staff already has service_role grants (003 + 106); no new grants needed for
-- ADD COLUMN on an existing granted table.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS voice_clone_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_clone_opt_out_at timestamptz;
