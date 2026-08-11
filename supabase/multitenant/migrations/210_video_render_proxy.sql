-- 210_video_render_proxy.sql
--
-- Reel-render cost fix (2026-08-11 — the 19-day reel outage: two prior
-- migrations of that story are the timeout fixes in api/_routes/cron/
-- auto-reel-week.js and .claude/decisions.md; this is the throughput fix).
--
-- The Strategist library's real footage is 4K at ~90-100 Mbps. Every reel
-- render currently re-downloads and re-decodes the FULL source master to
-- extract one ~15-30s window — and a single source video can hold several
-- detected moments (P1107562.MP4 has 7), so that decode cost is paid once
-- PER SEGMENT, not once per asset. Measured 2026-08-10: ~68s wall / 130s CPU
-- for the windowed 4K-to-1080 ingest alone, before the render pass itself.
--
-- This adds a persistent, whole-asset render proxy: a 1080-class re-encode of
-- the ENTIRE source (not windowed to one clip), generated once on first large-
-- source render and reused by every subsequent segment of that same asset,
-- from any caller. See api/_lib/videoRenderProxy.js.
--
--   render_proxy_url          TEXT        — Vercel Blob URL of the persisted
--                                            1080-class re-encode. NULL until
--                                            generated; NULL forever for an
--                                            asset that never needed one (see
--                                            shouldGenerateRenderProxy — the
--                                            same MAX_VIDEO_BYTES threshold
--                                            brandRenderVideo.js's ingest path
--                                            already uses to pick its fast vs.
--                                            large branch).
--   render_proxy_bytes        BIGINT      — Size of the proxy file, for cost
--                                            observability. NULL until generated.
--   render_proxy_generated_at TIMESTAMPTZ — When the proxy was produced. NULL
--                                            until generated. The source asset
--                                            is immutable once uploaded (no
--                                            re-upload/replace path exists), so
--                                            there is no invalidation story —
--                                            once generated, a proxy is valid
--                                            for the asset's lifetime.
--
-- Deliberately NOT web_blob_url/web_width/web_height (migration 057) — those
-- are the PHOTO resize variant, gated explicitly on kind==='photo' in
-- MediaDetail.jsx and consumed by the publish-image-mirror / ad-export /
-- BrandKit paths. A video render proxy is a different artifact with different
-- consumers; reusing that column would collide two meanings on one field.

alter table public.media_assets
  add column if not exists render_proxy_url          text,
  add column if not exists render_proxy_bytes         bigint,
  add column if not exists render_proxy_generated_at  timestamptz;

-- media_assets already has full service_role grants from migration 003.
-- ALTER TABLE preserves existing grants — new columns inherit them. This
-- migration is additive and safe to re-run.
