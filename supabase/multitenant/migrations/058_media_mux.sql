-- 058_media_mux.sql
--
-- Video transcoding via Mux. Per the 2026-05-20 media pipeline decision,
-- iPhone .mov uploads (HEVC) and other browser-hostile container/codec
-- combinations need a deliverable web variant. Self-hosting ffmpeg HLS
-- ladders inside Vercel Functions is the wrong tool for the job — encode
-- time scales with clip length, function timeouts are bounded, and adaptive
-- bitrate playback wants edge caching we don't operate. Mux handles all of
-- that and exposes an asset_id → playback_id contract that maps cleanly
-- onto our existing media_assets row.
--
-- Columns added:
--
--   mux_asset_id     text  — Mux's primary key for the asset (set when the
--                            upload completion webhook fires our create call).
--                            NULL on photo rows + legacy video rows.
--   mux_playback_id  text  — Mux playback ID used by the <mux-player>
--                            web component to render HLS. May be NULL until
--                            Mux's video.asset.ready webhook fires, since
--                            playback IDs are allocated alongside the asset
--                            but are not playable before ready.
--   transcode_status text  — 'pending'   — row inserted, Mux create not yet
--                                          called (transient — pipeline
--                                          fires inside the same webhook)
--                            'processing'— Mux create succeeded, awaiting
--                                          video.asset.ready
--                            'ready'     — playable
--                            'errored'   — transcode failed; the error
--                                          message is appended to notes
--                            'skipped'   — non-video kind or feature flag off
--                            NULL on legacy rows uploaded before this
--                            migration; UI treats NULL as 'skipped' so old
--                            uploads keep playing from blob_url.
--
-- Also adds a workspace-level toggle so individual tenants can opt their
-- playback policy out of "signed" if they intentionally want public videos
-- (marketing reels, etc.). Default is 'signed' — the safer posture for
-- clinic content, even if it's not strictly PHI.
--
--   workspaces.video_playback_policy text DEFAULT 'signed'
--                            'signed' (default) — playback requires a JWT
--                                                  minted by api/media/playback-token
--                            'public'           — mux_playback_id is enough
--                                                  to render <mux-player>

alter table public.media_assets
  add column if not exists mux_asset_id     text,
  add column if not exists mux_playback_id  text,
  add column if not exists transcode_status text;

-- Webhook lookup hits `mux_asset_id` — partial index keeps the lookup O(1)
-- even though the column is NULL on every photo row.
create index if not exists media_assets_mux_asset_id_idx
  on public.media_assets (mux_asset_id)
  where mux_asset_id is not null;

alter table public.workspaces
  add column if not exists video_playback_policy text default 'signed';

-- media_assets + workspaces already have full service_role grants from
-- migration 003. ALTER TABLE preserves grants on existing rows; new columns
-- inherit them. Additive + safe to re-run (IF NOT EXISTS).
