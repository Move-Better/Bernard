-- 188_interview_turn_timings.sql
--
-- Per-turn speech windows for a realtime voice interview, so a separately
-- recorded video of the same session can be cut per QUESTION instead of only
-- at AI-detected "moments".
--
-- Why this is needed:
--   interviews.messages is [{role, content, partial?}] — it carries WHAT was
--   said and in what order, but no timing at all. Migration 114 already gave us
--   the other half of the alignment (video_media_asset_id + video_offset_seconds,
--   where the offset is seconds into the phone recording at which speech begins),
--   so the only missing input for per-turn cutting is when each turn happened.
--
-- Why a separate column instead of fields on messages:
--   api/stream.js passes `messages` straight into the AI SDK's streamText({...})
--   with no normalization, so extra keys on those objects would be sent to the
--   model as unknown message properties. Keeping timings out of `messages`
--   leaves every existing reader (prompt builders, blog generation, voice-phrase
--   extraction, the fidelity judge, cleanup-transcript) untouched.
--
-- Shape: an ordered array of speech windows, in the order the audio happened.
--   [{ "role": "user"|"assistant", "startedAt": <epoch ms>, "endedAt": <epoch ms> }]
--
-- Epoch milliseconds (not seconds-since-call-start) because the video lives on
-- a different device: absolute wall clock is the only shared reference, and
-- relative time is one subtraction away from the first window. Sub-500ms
-- ambient-noise blips are not recorded, matching the same gate PhoneCall.jsx
-- already applies before it renders or answers a user turn — so the recorded
-- windows correspond to turns that actually made it into `messages`.

alter table public.interviews
  add column if not exists turn_timings jsonb not null default '[]'::jsonb;

comment on column public.interviews.turn_timings is
  'Ordered speech windows for a realtime voice interview: [{role, startedAt, endedAt}] in epoch ms. Paired with video_offset_seconds (migration 114) to map a turn onto a separately-recorded video timeline.';

grant select, insert, update, delete on public.interviews to service_role;
