// /api/editorial/render-clip-job
//
// Async render-job endpoint for the embedded reel bake. Two methods:
//
//   POST — create + kick. Validates fast (shared renderClipCore), creates a
//          clip_render_jobs row in 'rendering', kicks the worker on a FRESH
//          function budget, and returns 202 { jobId } for the client to poll.
//          This is the reel-bake analog of export-clip.js's 202 pattern — it
//          exists so a long/hi-res EDITED reel renders on its own 300s budget
//          instead of blowing the ceiling of a single synchronous request and
//          504'ing the bake (which aborts Approve/Schedule/Publish).
//
//   GET  — poll. Returns the job's terminal state so doRenderClip (VideoEditor)
//          can await the blob and then do its usual client-side finalization
//          (media_urls stamp + source-asset draft flush). Workspace-scoped.
//
// The render itself runs behind CRON_SECRET in render-clip-job-worker.js; this
// endpoint never renders.
//
// Body (POST): the editor renderBody (assetId + clip window + all edit params).
// Query (GET): ?id=<clip_render_jobs.id>
//
// Responses:
//   POST 202 { jobId, status: 'rendering' }
//   GET  200 { status, blobUrl?, width?, height?, sizeBytes?, hadSubtitles?, error? }
//   400 / 401 / 403 / 404 / 415 / 500
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled (mirrors
// export-clip.js / render-clip.js exactly).

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { resolveClipRender } from '../_lib/renderClipCore.js'
import { createPendingRenderJob, postRenderJobWorker } from '../_lib/clipRenderJobEngine.js'
import { supabaseRest } from '../_lib/supabaseRest.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json' })

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  if (!ws.video_pipeline_enabled) {
    return res.status(403).json({ error: 'feature_disabled' })
  }

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // --- GET: poll a job's status (workspace-scoped) ---
  if (req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || ''
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

    const r = await sb(
      `clip_render_jobs?id=eq.${id}&workspace_id=eq.${ws.id}` +
        `&select=status,blob_url,width,height,size_bytes,had_subtitles,duration_s,error&limit=1`,
    )
    if (!r.ok) {
      console.error('[render-clip-job] status read failed:', r.status)
      return res.status(500).json({ error: 'db_error' })
    }
    const row = (await r.json())?.[0]
    if (!row) return res.status(404).json({ error: 'job_not_found' })
    return res.status(200).json({
      status:       row.status,
      blobUrl:      row.blob_url || null,
      width:        row.width || null,
      height:       row.height || null,
      sizeBytes:    row.size_bytes || null,
      hadSubtitles: row.had_subtitles ?? null,
      durationS:    row.duration_s ?? null,
      error:        row.error || null,
    })
  }

  // --- POST: create + kick ---
  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const body = req.body || {}

  // Fail-fast: validate + fetch the source asset now, so a bad request gets a
  // proper 4xx instead of a 202 followed by a silent 'failed' the client has to
  // discover by polling. The worker re-resolves on its own fresh instance.
  const resolved = await resolveClipRender({ ws, body })
  if (!resolved.ok) {
    return res.status(resolved.status).json({ error: resolved.error, ...(resolved.extra || {}) })
  }
  if (!resolved.params.isVideo) {
    return res.status(415).json({ error: 'not_a_video' })
  }

  // The worker self-POST needs a reachable origin + CRON_SECRET. Check BEFORE
  // creating the row so a misconfigured env can't leave a stranded 'rendering'
  // job the client polls forever.
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const baseUrl = req.headers.host ? `${proto}://${req.headers.host}` : null
  if (!baseUrl || !process.env.CRON_SECRET) {
    console.error('[render-clip-job] worker unreachable — missing host or CRON_SECRET')
    return res.status(500).json({ error: 'render_unavailable' })
  }

  let jobId
  try {
    jobId = await createPendingRenderJob({ ws })
  } catch (e) {
    console.error('[render-clip-job] createPendingRenderJob failed:', e?.message)
    return res.status(500).json({ error: 'render_init_failed' })
  }

  // Hand the baton off the request path. waitUntil keeps this instance alive
  // until the worker acks (fast — it schedules the render in its own waitUntil).
  waitUntil(postRenderJobWorker(baseUrl, { jobId, workspaceId: ws.id, body }))

  return res.status(202).json({ jobId, status: 'rendering' })
}
