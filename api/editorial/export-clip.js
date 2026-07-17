// POST /api/editorial/export-clip
//
// Async orchestrator for the Moment Miner "Save to Library" (b-roll) export.
//
// The old path rendered the clip SYNCHRONOUSLY inside the request
// (render-clip → clip-to-broll) and returned the encoded MP4 — a long/hi-res
// clip blew Vercel's 300s ceiling → 504 ("Failed Export to library"). This
// handler validates fast, creates the destination b-roll row in the 'rendering'
// state, kicks the worker on a fresh function budget, and returns 202 with the
// new asset id for the client to poll. Mirrors render-longform's 202 pattern.
//
// Body: the editor renderBody (assetId + clip window + all edit params) plus
//   { captionText?, briefId? }.
//
// Responses:
//   202 { assetId, status: 'rendering' }   — b-roll row created, render kicked
//   400 / 401 / 403 / 404 / 415 / 500      — validation / auth / init failures
//
// Auth: Clerk JWT + workspace org-id + video_pipeline_enabled (mirrors
// render-clip.js exactly). The render itself runs behind CRON_SECRET in the
// worker; this handler never renders.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { resolveClipRender } from '../_lib/renderClipCore.js'
import { createPendingBroll, postExportWorker } from '../_lib/exportClipEngine.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
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

  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const body = req.body || {}

  // Fail-fast: validate + fetch the source asset now, so a bad request gets a
  // proper 4xx instead of a 202 followed by a silent 'failed' the user has to
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
  // b-roll in the Library.
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const baseUrl = req.headers.host ? `${proto}://${req.headers.host}` : null
  if (!baseUrl || !process.env.CRON_SECRET) {
    console.error('[export-clip] worker unreachable — missing host or CRON_SECRET')
    return res.status(500).json({ error: 'export_unavailable' })
  }

  const captionText = String(body.captionText || '').slice(0, 500)
  const briefId = body.briefId ? String(body.briefId) : null
  const notes = `B-roll clip from asset ${resolved.asset.id}${captionText ? ` — "${captionText.slice(0, 80)}"` : ''}`

  let brollAssetId
  try {
    brollAssetId = await createPendingBroll({ ws, sourceAsset: resolved.asset, notes })
  } catch (e) {
    console.error('[export-clip] createPendingBroll failed:', e?.message)
    return res.status(500).json({ error: 'export_init_failed' })
  }

  // Hand the baton off the request path. waitUntil keeps this instance alive
  // until the worker acks (fast — it schedules the render in its own waitUntil).
  waitUntil(postExportWorker(baseUrl, { brollAssetId, workspaceId: ws.id, body, briefId, captionText }))

  return res.status(202).json({ assetId: brollAssetId, status: 'rendering' })
}
