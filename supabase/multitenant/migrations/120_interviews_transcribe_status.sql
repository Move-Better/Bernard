-- 120_interviews_transcribe_status.sql
--
-- Seminar / Talk capture lane (Slice ①): long talks (45–90+ min) are
-- transcribed in a BACKGROUND worker, not synchronously in the request — a
-- 71-min file takes ~239s and a 2-hour talk would blow past the 300s function
-- timeout. The worker chunks the audio (ffmpeg), transcribes each segment via
-- Whisper, stitches the transcript into messages[0].content, then flips this
-- column to 'ready'. The UI polls (with a hard cap) until then.
--
-- transcribe_status — nullable; ONLY seminar-lane rows set it.
--   'processing' — worker is running (set at interview-create time)
--   'ready'      — transcript stitched into messages, safe to generate from
--   'failed'     — worker hit an unrecoverable error (UI shows retry)
-- Chat/voice-memo/text-import rows leave this NULL.

alter table public.interviews
  add column if not exists transcribe_status text;

-- Idempotent constraint add (drop-then-add so re-running after a tweak is safe).
alter table public.interviews
  drop constraint if exists interviews_transcribe_status_check;

alter table public.interviews
  add constraint interviews_transcribe_status_check
    check (transcribe_status is null
           or transcribe_status in ('processing', 'ready', 'failed'));

-- service_role grants. New columns inherit table-level grants automatically,
-- but re-stating here keeps this migration self-sufficient per CLAUDE.md.
grant select, insert, update, delete on public.interviews to service_role;
