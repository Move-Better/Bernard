import { withSentry } from '../../_lib/sentry.js'
import { segmentById } from '../../_lib/segmentInterview.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'

// Manual AI segmenter endpoint. POST { id } → reads the source interview's
// existing transcription (from Phase 2) and inserts 1–5 content_pieces rows
// in `suggested` state via Sonnet 4.6 through the Vercel AI Gateway. The
// shared logic lives in _lib/segmentInterview.js so upload.js can call it
// directly via waitUntil without an HTTP roundtrip.
//
// Runs on Node (Fluid Compute). (req, res) handler shape; req.body auto-parsed.

export const config = { runtime: 'nodejs', maxDuration: 120 }

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const id = req.body?.id
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })

  // Segmentation creates content_pieces rows — same gate as content-piece
  // creation: admin or publisher. Clinicians can browse but can't fan out.
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', scope.workspace.id))) return

  try {
    const pieces = await segmentById(id, scope)
    return res.status(200).json({ count: pieces.length, pieces })
  } catch (e) {
    const msg = e?.message || 'Segmentation failed'
    const status = msg === 'Not found' ? 404 : 500
    return res.status(status).json({ error: msg })
  }
}

export default withSentry(handler)
