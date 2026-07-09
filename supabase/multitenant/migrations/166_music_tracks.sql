-- Music library (WS3.3-P2): licensed background tracks for video clips, mixed
-- under the voice with auto-duck by api/_lib/brandRenderVideo.js.
--
-- workspace_id is NULLABLE by design:
--   • NULL          → SHARED library — a curated, royalty-free starter set every
--                     workspace sees for free (seeded by platform admins via
--                     scripts/upload-music-tracks.mjs). Tenants can't edit these.
--   • <workspace>   → that tenant's OWN uploads (admins only), managed in
--                     Settings → Music.
-- The editor's music picker (GET /api/editorial/music-tracks) returns shared +
-- the caller's own; the render route resolves a trackId → blob_url from here.

CREATE TABLE public.music_tracks (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        REFERENCES public.workspaces(id) ON DELETE CASCADE, -- NULL = shared/global
  title         text        NOT NULL,
  mood          text        NOT NULL
                            CHECK (mood IN ('calm', 'upbeat', 'warm', 'cinematic')),
  blob_url      text        NOT NULL,
  duration_sec  integer,
  uploaded_by   text,                                -- Clerk user id of the uploader (null for seeded shared)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Picker query filters `workspace_id IS NULL OR workspace_id = eq.<ws>` and
-- orders by created_at; index both access paths.
CREATE INDEX IF NOT EXISTS music_tracks_workspace_idx ON public.music_tracks (workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.music_tracks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
