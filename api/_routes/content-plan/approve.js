// POST /api/content-plan/approve  { piece_id }
// Approve a drafted content_item from the /week surface (status → approved).
// Buffer dispatch (scheduling) happens client-side via publishPieceToBuffer +
// useUpdateContentItemStatus, matching the ReviewInbox pattern. This endpoint
// is the server-side half: it validates ownership, checks the piece is ready,
// and flips status to 'approved'. The client then calls publishPieceToBuffer
// with use_queue=true (or a specific scheduled_at) and finally updates status
// to 'scheduled' via the standard /api/db/content PATCH route.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

const ok  = (res, data) => res.status(200).json(data)
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'content-plan-approve'))) return

  const wsFilter = `workspace_id=eq.${ws.id}`
  const { piece_id } = req.body || {}
  if (!piece_id) return err(res, 'Missing piece_id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(piece_id)) return err(res, 'Invalid piece_id')

  // Verify piece belongs to this workspace and is in an approvable state.
  const ciRes = await sb(`content_items?id=eq.${piece_id}&${wsFilter}&select=id,status`)
  if (!ciRes.ok) return err(res, 'Database error', 500)
  const ciRows = await ciRes.json()
  if (!ciRows.length) return err(res, 'Content piece not found', 404)
  const piece = ciRows[0]

  if (piece.status === 'approved' || piece.status === 'scheduled' || piece.status === 'published') {
    return ok(res, { status: piece.status, alreadyApproved: true })
  }
  const APPROVABLE_STATUSES = new Set(['draft', 'in_review'])
  if (!APPROVABLE_STATUSES.has(piece.status)) {
    return err(res, `Piece is not ready to approve (status: ${piece.status})`, 422)
  }

  const approvedBy = auth.userId || 'unknown'
  const nowIso = new Date().toISOString()
  const patchRes = await sb(`content_items?id=eq.${piece_id}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', approved_by: approvedBy, approved_at: nowIso, updated_at: nowIso }),
  })
  if (!patchRes.ok) return err(res, 'Failed to approve piece', 500)

  return ok(res, { status: 'approved' })
}
