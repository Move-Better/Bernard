-- "Make a point" interviews.
--
-- An interview can now be one of two kinds:
--   'topic' — the existing clinical extraction interview (default; every
--             pre-existing row is this).
--   'point' — the guest brings a specific point they want to make, drawn from
--             their own experience, and a dynamic podcast-host interviewer
--             sharpens it. `point` holds the seed text the host is briefed on.
--
-- No CHECK constraint on `kind`: the API layer (api/_routes/db/interviews.js)
-- validates it to {topic, point}, matching how story_type is handled. Adding a
-- CHECK later would require an ALTER when a third kind appears; the app guard is
-- the single source of truth.
--
-- Column privileges inherit the table-level grants already held by service_role
-- on public.interviews, so no new GRANT is required for these columns.

alter table public.interviews
  add column if not exists kind  text not null default 'topic',
  add column if not exists point text;

comment on column public.interviews.kind is
  'Interview kind: ''topic'' (clinical extraction, default) or ''point'' ("Make a point" — guest-supplied thesis sharpened by a dynamic host).';
comment on column public.interviews.point is
  'For kind=''point'': the free-text point the user wants to make, seeded verbatim into getPointInterviewSystemPrompt.';
