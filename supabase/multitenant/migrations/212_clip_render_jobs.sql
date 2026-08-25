-- 212 — clip_render_jobs: async render-job carrier for the embedded reel bake.
--
-- The embedded VideoEditor bakes the current trim/caption/grade edit into the
-- post's media_urls before Approve/Schedule/Publish (#2638), by rendering the
-- clip and writing the finished blob back. That render used to run SYNCHRONOUSLY
-- inside POST /api/editorial/render-clip (maxDuration 300) — the SAME shape the
-- b-roll "Save to Library" export had before it moved async: a long/hi-res
-- EDITED reel can approach the 300s wall and 504, which aborts the commit and
-- makes that reel un-publishable.
--
-- This table is the destination-agnostic job carrier the reel bake polls, the
-- direct analog of the b-roll path's media_assets.render_status and the longform
-- path's story_packages.status. The orchestrator (render-clip-job.js) creates a
-- row here in 'rendering', kicks a worker on a FRESH 300s budget, and returns
-- 202 { jobId }. The worker renders (shared renderClipCore) and flips the row to
-- 'ready' (blob_url + dims) or 'failed' (error). The CLIENT polls this row and,
-- on 'ready', does the exact same media_urls finalization it does today — the
-- fingerprint stamp + draft flush + content_items PATCH stay 100% client-side,
-- so the WYSIWYG contract is never duplicated server-side (the mirror-pair
-- hazard the whole videoEditFingerprint design exists to avoid).
--
-- These rows are transient job records, not content. A SIGKILL at the 300s wall
-- runs no catch, so a row can strand at 'rendering'; sweep-stuck-clip-exports
-- (every 5 min) flips any long-stuck 'rendering' row to 'failed' — the same
-- terminal state the worker's catch writes — so the client poll always settles.

CREATE TABLE IF NOT EXISTS public.clip_render_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- rendering → ready | failed. Guarded terminal writes (WHERE status=rendering)
  -- so a duplicate worker / cron sweep can never double-write a settled row.
  status         text NOT NULL DEFAULT 'rendering'
                   CHECK (status IN ('rendering', 'ready', 'failed')),

  -- Set together on the terminal 'ready' write. The client reads blob_url as the
  -- baked output and threads width/height/size back into the media entry it
  -- writes onto content_items.media_urls.
  blob_url       text,
  blob_pathname  text,
  width          integer,
  height         integer,
  size_bytes     bigint,
  had_subtitles  boolean,
  duration_s     double precision,

  -- Populated on the terminal 'failed' write (or by the cron sweep: 'render_timeout').
  error          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- The sweep and the client poll both filter on (status, updated_at); a partial
-- index over the only status the sweep touches keeps that scan cheap as the
-- table accumulates terminal rows.
CREATE INDEX IF NOT EXISTS clip_render_jobs_stuck_idx
  ON public.clip_render_jobs (updated_at)
  WHERE status = 'rendering';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clip_render_jobs TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
