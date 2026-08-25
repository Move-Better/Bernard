// api/_lib/clipRenderJobEngine.js
//
// The async render-job engine for the embedded reel bake. Mirrors
// exportClipEngine (the b-roll "Save to Library" path) beat-for-beat, with two
// deliberate differences:
//
//   1. Destination — this writes to a transient clip_render_jobs row (a job
//      carrier), NOT a permanent media_assets b-roll asset. The reel bake's
//      output belongs on content_items.media_urls, and the CLIENT writes it
//      there (with the videoEditHash stamp + the source-asset draft flush) after
//      polling this job to 'ready'. Keeping that finalization client-side is the
//      whole point: the WYSIWYG media-entry construction is never duplicated
//      server-side (the client/server mirror-pair hazard — see
//      src/lib/videoEditFingerprint.js).
//
//   2. No enrichment — the b-roll path generates a poster + visual-memory index
//      + closes a brief. None applies here: the reel entry reuses the existing
//      entry's thumbnailUrl, and there is no Library asset to index.
//
// Flow (identical baton pattern to exportClipEngine / render-longform):
//   1. Orchestrator (render-clip-job.js) validates, creates the job row in
//      'rendering', kicks the worker via CRON_SECRET self-POST, returns 202.
//   2. Worker (render-clip-job-worker.js) calls runReelRender() inside waitUntil
//      on a FRESH function instance with its own 300s budget.
//   3. runReelRender re-resolves + renders (shared renderClipCore) + uploads,
//      then flips the row to 'ready' (blob_url set) or 'failed' (error). The
//      client polls the row until it settles.
//
// A killed function runs no finally/catch, so a worker SIGKILL at the 300s wall
// could strand the row at 'rendering'. The cron safety-net
// (api/_routes/cron/sweep-stuck-clip-exports.js) flips any long-stuck 'rendering'
// row to 'failed' — the same terminal state runReelRender's catch writes.

import { workspaceById } from './workspaceContext.js'
import { resolveClipRender, runClipRender } from './renderClipCore.js'

import { supabaseRest } from './supabaseRest.js'

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

/**
 * Create the job row up front, in 'rendering', so the client has a stable id to
 * poll immediately. Returns the new clip_render_jobs.id.
 *
 * @param {Object} p
 * @param {Object} p.ws  resolved workspace row (must have .id)
 */
export async function createPendingRenderJob({ ws }) {
  const res = await sb('clip_render_jobs', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: ws.id, status: 'rendering' }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`render job insert failed: ${res.status} ${text}`)
  }
  const id = (await res.json())?.[0]?.id
  if (!id) throw new Error('render job insert returned no id')
  return id
}

/**
 * Kick the worker on a fresh instance. The worker schedules its render via
 * waitUntil and returns 202 fast, so this await resolves quickly and the
 * orchestrator hands the baton cleanly. Returns true if the POST was issued.
 */
export async function postRenderJobWorker(baseUrl, payload) {
  if (!baseUrl || !process.env.CRON_SECRET) return false
  try {
    await fetch(`${baseUrl}/api/editorial/render-clip-job-worker`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(payload),
    })
    return true
  } catch (e) {
    console.error('[clipRenderJobEngine] worker post failed:', e?.message || e)
    return false
  }
}

// Guarded terminal write — only lands while the row is still 'rendering', so a
// duplicate worker / cron sweep can't double-write and a since-deleted row is a
// clean no-op. Returns true if it actually updated the row. Retries a transient
// non-2xx so a brief DB blip can't strand the row.
async function patchJobTerminal(jobId, workspaceId, body) {
  const payload = JSON.stringify({ ...body, updated_at: new Date().toISOString() })
  const path = `clip_render_jobs?id=eq.${jobId}&workspace_id=eq.${workspaceId}&status=eq.rendering`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await sb(path, { method: 'PATCH', body: payload })
    if (res.ok) {
      const rows = await res.json().catch(() => null)
      return Array.isArray(rows) && rows.length > 0
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
  }
  console.error(`[clipRenderJobEngine] terminal PATCH failed after retries for ${jobId}`)
  return false
}

/**
 * Render the clip and flip the job row to its terminal state. Runs on the
 * worker's fresh 300s budget (inside waitUntil). Never throws — always writes a
 * terminal status so the client's poll settles.
 *
 * @param {Object} p
 * @param {string} p.jobId        the pending job row to patch
 * @param {string} p.workspaceId  workspace id (round-tripped from the orchestrator)
 * @param {Object} p.body         the editor renderBody (re-resolved here)
 */
export async function runReelRender({ jobId, workspaceId, body }) {
  try {
    const ws = await workspaceById(workspaceId)
    if (!ws) {
      await patchJobTerminal(jobId, workspaceId, { status: 'failed', error: 'workspace_not_found' })
      return
    }

    const resolved = await resolveClipRender({ ws, body: body || {} })
    if (!resolved.ok) {
      await patchJobTerminal(jobId, ws.id, { status: 'failed', error: String(resolved.error || 'invalid_request').slice(0, 300) })
      return
    }
    if (!resolved.params.isVideo) {
      await patchJobTerminal(jobId, ws.id, { status: 'failed', error: 'not_a_video' })
      return
    }

    const { renders, errors } = await runClipRender({ ws, asset: resolved.asset, params: resolved.params })
    const out = renders[0]
    if (!out?.blobUrl) {
      await patchJobTerminal(jobId, ws.id, { status: 'failed', error: String(errors[0]?.error || 'render_failed').slice(0, 300) })
      return
    }

    let blobPathname = null
    try { blobPathname = new URL(out.blobUrl).pathname } catch { /* keep null */ }
    const dur = resolved.params.durationSec

    await patchJobTerminal(jobId, ws.id, {
      status:        'ready',
      blob_url:      out.blobUrl,
      blob_pathname: blobPathname,
      width:         out.width || null,
      height:        out.height || null,
      size_bytes:    out.sizeBytes || null,
      had_subtitles: out.hadSubtitles ?? null,
      duration_s:    Number.isFinite(dur) ? dur : null,
      error:         null,
    })
  } catch (e) {
    console.error('[clipRenderJobEngine] runReelRender crashed:', e?.stack || e?.message || e)
    await patchJobTerminal(jobId, workspaceId, { status: 'failed', error: 'render_crashed' }).catch(() => {})
  }
}
