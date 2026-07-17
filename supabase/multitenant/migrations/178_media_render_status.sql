-- 178_media_render_status.sql
--
-- Async clip-export render status on media_assets.
--
-- The "Save to Library" clip export used to render SYNCHRONOUSLY inside the HTTP
-- request and return the encoded MP4 in the response body. A long/heavy clip
-- (e.g. a 56s hi-res source that hits the ingest-downscale + karaoke pass) blew
-- Vercel's 300s function ceiling → FUNCTION_INVOCATION_TIMEOUT (504), which the
-- user saw as "Failed Export to library".
--
-- The export now offloads to a worker on a FRESH function budget (mirrors
-- api/editorial/render-longform + render-longform-worker): the destination
-- b-roll row is created up front with render_status='rendering', a CRON_SECRET-
-- authed worker renders + uploads + flips it to 'ready' (blob_url set) or
-- 'failed' (+ render_error). The client polls the row via the MediaDetail
-- refetch contract until it settles.
--
-- This mirrors the existing segment_status / segment_error async pattern already
-- on this table (the "Find clips" detection job). Like segment_status there is
-- no CHECK constraint; the value space is:
--   null (not an async render) | 'rendering' | 'ready' | 'failed'

alter table public.media_assets
  add column if not exists render_status text,
  add column if not exists render_error  text;

-- New columns inherit the table's existing grants, but re-assert for parity with
-- the project's self-sufficient-migration convention (idempotent; mirrors
-- 003_grant_service_role.sql). The REST API runs as service_role.
grant select, insert, update, delete on public.media_assets to service_role;
