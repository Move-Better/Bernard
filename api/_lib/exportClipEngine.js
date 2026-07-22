// api/_lib/exportClipEngine.js
//
// The async "Save to Library" clip-export engine. The export used to render
// SYNCHRONOUSLY inside the request (api/editorial/render-clip → clip-to-broll),
// so a long/hi-res clip blew Vercel's 300s ceiling → 504 ("Failed Export to
// library"). This offloads the render to a worker on a FRESH function budget,
// mirroring the render-longform / render-longform-worker baton pattern.
//
// Flow:
//   1. Orchestrator (export-clip.js) validates, creates the destination b-roll
//      media_assets row up front with render_status='rendering', then kicks the
//      worker via a CRON_SECRET self-POST and returns 202 { assetId } fast.
//   2. Worker (export-clip-worker.js) calls runExportRender() inside waitUntil,
//      on a fresh instance with its own 300s budget.
//   3. runExportRender re-resolves + renders + uploads (shared renderClipCore),
//      then flips the row to render_status='ready' (blob_url set) or 'failed'
//      (+ render_error). The client polls the row until it settles.
//
// A killed function runs no finally/catch, so a worker SIGKILL at the 300s wall
// could strand the row at 'rendering'. The cron safety-net
// (api/cron/sweep-stuck-clip-exports.js) flips any long-stuck 'rendering' row to
// 'failed' — the same terminal state runExportRender's catch writes.

import { workspaceById } from './workspaceContext.js'
import { resolveClipRender, runClipRender } from './renderClipCore.js'
import { indexMediaAsset } from './visualMemoryIndex.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

/**
 * Create the destination b-roll row up front, in the 'rendering' state, so the
 * client has a stable id to poll and the Library shows a "Rendering…" tile
 * immediately. Mirrors the shape saveBroll writes, minus the blob (set by the
 * worker on completion). Returns the new media_assets.id.
 *
 * @param {Object} p
 * @param {Object} p.ws           resolved workspace row (must have .id)
 * @param {Object} p.sourceAsset  the source media_assets row (id, staff_id, filename)
 * @param {string} p.notes        provenance note
 */
export async function createPendingBroll({ ws, sourceAsset, notes }) {
  const base = String(sourceAsset.filename || 'clip').replace(/\.\w+$/, '').replace(/[^\w.-]/g, '_') || 'clip'
  const row = {
    workspace_id:     ws.id,
    kind:             'video',
    asset_purpose:    'broll',
    source:           'moments',
    // 'tagged', not the retired 'approved' — a derived asset is ready to use
    // and skips auto-tagging, which is exactly what 'tagged' already means.
    status:           'tagged',
    blob_url:         null,               // set by the worker on completion
    filename:         `${base}-clip.mp4`,
    mime_type:        'video/mp4',
    staff_id:         sourceAsset.staff_id || null,
    parent_asset_id:  sourceAsset.id,
    // Renders are already-processed mp4s — no Mux transcode. 'skipped' keeps the
    // Mux stuck-transcode sweep (mux_asset_id=not.is.null) away from this row.
    transcode_status: 'skipped',
    render_status:    'rendering',
    notes:            notes || null,
  }
  const res = await sb('media_assets', { method: 'POST', body: JSON.stringify(row) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`pending broll insert failed: ${res.status} ${text}`)
  }
  const id = (await res.json())?.[0]?.id
  if (!id) throw new Error('pending broll insert returned no id')
  return id
}

/**
 * Kick the worker on a fresh instance. The worker schedules its render via
 * waitUntil and returns 202 fast, so this await resolves quickly and the
 * orchestrator hands the baton cleanly. Returns true if the POST was issued.
 */
export async function postExportWorker(baseUrl, payload) {
  if (!baseUrl || !process.env.CRON_SECRET) return false
  try {
    await fetch(`${baseUrl}/api/editorial/export-clip-worker`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify(payload),
    })
    return true
  } catch (e) {
    console.error('[exportClipEngine] worker post failed:', e?.message || e)
    return false
  }
}

// Guarded terminal write — only lands while the row is still 'rendering', so a
// duplicate worker / cron sweep can't double-write and a since-deleted row is a
// clean no-op. Returns true if it actually updated the row. Retries a transient
// non-2xx so a brief DB blip can't strand the row.
async function patchBrollTerminal(brollAssetId, workspaceId, body) {
  const payload = JSON.stringify({ ...body, updated_at: new Date().toISOString() })
  const path = `media_assets?id=eq.${brollAssetId}&workspace_id=eq.${workspaceId}&render_status=eq.rendering`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await sb(path, { method: 'PATCH', body: payload })
    if (res.ok) {
      const rows = await res.json().catch(() => null)
      return Array.isArray(rows) && rows.length > 0
    }
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
  }
  console.error(`[exportClipEngine] terminal PATCH failed after retries for ${brollAssetId}`)
  return false
}

// Media Hub "Edit clip in Bernard" round-trip close-out. When the clip was
// opened from a brief, saving it to the Library stamps the finished asset onto
// the brief and flips it to 'returned' — mirrors clip-to-broll's brief close.
// Scoped hard: the PATCH requires the brief to be in THIS workspace AND to have
// this exact source asset, so a stray/tampered briefId can never touch another.
async function closeBrief({ ws, briefId, sourceAssetId, brollAssetId }) {
  if (!briefId || !brollAssetId) return
  if (!UUID_RE.test(briefId)) { console.warn('[exportClipEngine] ignoring non-UUID briefId'); return }
  const pr = await sb(
    `content_pieces?id=eq.${briefId}&workspace_id=eq.${ws.id}&source_asset_id=eq.${sourceAssetId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        final_asset_id: brollAssetId,
        status: 'returned',
        returned_at: new Date().toISOString(),
      }),
    },
  )
  if (!pr.ok) console.error('[exportClipEngine] brief close PATCH failed:', pr.status)
}

/**
 * Render the clip and flip the pending b-roll row to its terminal state. Runs on
 * the worker's fresh 300s budget (inside waitUntil). Never throws — always
 * writes a terminal render_status so the client's poll settles.
 *
 * @param {Object} p
 * @param {string} p.brollAssetId  the pending destination row to patch
 * @param {string} p.workspaceId   workspace id (round-tripped from the orchestrator)
 * @param {Object} p.body          the editor renderBody (re-resolved here)
 * @param {string|null} p.briefId  optional Media Hub brief to close on success
 */
export async function runExportRender({ brollAssetId, workspaceId, body, briefId }) {
  try {
    const ws = await workspaceById(workspaceId)
    if (!ws) {
      await patchBrollTerminal(brollAssetId, workspaceId, { render_status: 'failed', render_error: 'workspace_not_found' })
      return
    }

    const resolved = await resolveClipRender({ ws, body: body || {} })
    if (!resolved.ok) {
      await patchBrollTerminal(brollAssetId, ws.id, { render_status: 'failed', render_error: String(resolved.error || 'invalid_request').slice(0, 300) })
      return
    }
    if (!resolved.params.isVideo) {
      await patchBrollTerminal(brollAssetId, ws.id, { render_status: 'failed', render_error: 'not_a_video' })
      return
    }

    const { renders, errors } = await runClipRender({ ws, asset: resolved.asset, params: resolved.params })
    const out = renders[0]
    if (!out?.blobUrl) {
      await patchBrollTerminal(brollAssetId, ws.id, { render_status: 'failed', render_error: String(errors[0]?.error || 'render_failed').slice(0, 300) })
      return
    }

    let blobPathname = null
    try { blobPathname = new URL(out.blobUrl).pathname } catch { /* keep null */ }
    const dur = resolved.params.durationSec

    const landed = await patchBrollTerminal(brollAssetId, ws.id, {
      blob_url:      out.blobUrl,
      blob_pathname: blobPathname,
      width:         out.width || null,
      height:        out.height || null,
      size_bytes:    out.sizeBytes || null,
      duration_s:    Number.isFinite(dur) ? dur : null,
      render_status: 'ready',
      render_error:  null,
    })
    if (!landed) return  // row deleted or already settled (e.g. cron swept it)

    // Post-completion enrichment — best-effort, never blocks the terminal write.
    await indexMediaAsset({ assetId: brollAssetId })
      .catch((e) => console.error('[exportClipEngine] visual-memory index failed:', e?.message))
    await closeBrief({ ws, briefId, sourceAssetId: String(body?.assetId || ''), brollAssetId })
      .catch((e) => console.error('[exportClipEngine] brief close failed:', e?.message))
  } catch (e) {
    console.error('[exportClipEngine] runExportRender crashed:', e?.stack || e?.message || e)
    await patchBrollTerminal(brollAssetId, workspaceId, { render_status: 'failed', render_error: 'render_crashed' }).catch(() => {})
  }
}
