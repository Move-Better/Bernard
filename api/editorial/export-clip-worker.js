// POST /api/editorial/export-clip-worker
//
// Internal continuation endpoint for the async "Save to Library" clip export.
// The orchestrator (export-clip.js) creates the pending b-roll row and POSTs
// here so the render runs on a FRESH function instance with a new 300s budget —
// the whole point, since a heavy clip rendered synchronously blew the ceiling
// and 504'd the user.
//
// It schedules the render via waitUntil and returns 202 immediately, so the
// orchestrator's kick fetch resolves fast and the ending instance hands the
// baton cleanly. The render (renderClipCore) runs off the request path and
// always writes a terminal render_status onto the b-roll row.
//
// Auth: Bearer CRON_SECRET (same shared secret as the cron handlers). This is a
// service-role, no-user-token path — never call it from the browser.
//
// Body: { brollAssetId, workspaceId, body: <renderBody>, briefId?, captionText? }
// Responses: 202 { ok: true } | 400 | 401

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { verifyCronSecret } from '../_lib/auth.js'
import { runExportRender } from '../_lib/exportClipEngine.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const b = req.body || {}
  const brollAssetId = b.brollAssetId ? String(b.brollAssetId) : ''
  const workspaceId = b.workspaceId ? String(b.workspaceId) : ''
  if (!UUID_RE.test(brollAssetId)) return res.status(400).json({ error: 'invalid_brollAssetId' })
  if (!UUID_RE.test(workspaceId)) return res.status(400).json({ error: 'invalid_workspaceId' })
  if (!b.body || typeof b.body !== 'object' || Array.isArray(b.body)) {
    return res.status(400).json({ error: 'body_required' })
  }
  const briefId = b.briefId ? String(b.briefId) : null

  // Render off the request path on this fresh budget; runExportRender never
  // throws — it always writes a terminal render_status.
  waitUntil(runExportRender({ brollAssetId, workspaceId, body: b.body, briefId }))

  return res.status(202).json({ ok: true })
}
