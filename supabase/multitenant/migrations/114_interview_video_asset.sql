-- 114_interview_video_asset.sql
-- Adds video_media_asset_id to interviews so a separately-recorded iPhone video
-- can be attached after an audio interview completes.
--
-- Workflow:
--   1. Clinician runs audio interview on laptop (existing path, unchanged).
--   2. iPhone on tripod records the whole session via native camera app.
--   3. After interview ends, clinician uploads the iPhone video.
--   4. The uploaded media_asset is linked here; existing pipeline (ClipFinder,
--      captions, publishing) runs on the video asset with the interview transcript.
--
-- video_offset_seconds: how many seconds into the iPhone recording the interview
-- actually started. Set via a "trim start" UI at upload time. Used by clip
-- extraction to align transcript timestamps with the video.

alter table public.interviews
  add column if not exists video_media_asset_id uuid references public.media_assets(id) on delete set null,
  add column if not exists video_offset_seconds numeric(6,2) not null default 0;

-- Index for the reverse lookup: "which interview is this video attached to?"
create index if not exists interviews_video_media_asset_idx
  on public.interviews(video_media_asset_id)
  where video_media_asset_id is not null;

grant select, insert, update, delete on public.interviews to service_role;
