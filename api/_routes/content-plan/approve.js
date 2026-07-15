// POST /api/content-plan/approve  { piece_id }
// Approve a drafted content_item from the /week surface AND dispatch it — one
// action = approve + schedule (Standing Producer Phase 2B). Flips status to
// 'approved', then dispatches server-side via dispatchContentItem() so it no
// longer depends on the browser tab completing the Buffer/bundle call.
//
// Response tells the client whether the server finished the job:
//   { status:'scheduled', dispatched:true, scheduledAt }         — done server-side
//   { status:'approved', dispatched:false, fallback:'client', needs_client_bake? }
//                                                                — client runs publishPieceToBuffer
//   { status:'approved', dispatched:false, error }               — surface; client must NOT re-dispatch
//   { status:'approved', dispatched:false, reason:'in_progress' } — another dispatch holds the claim
//   { status, alreadyApproved:true }                             — already scheduled/published
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { dispatchContentItem } from '../../_lib/dispatchContentItem.js'

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

  if (!(await enforceLimit(req, res, 'content-plan-approve', ws.id))) return

  const wsFilter = `workspace_id=eq.${ws.id}`
  const { piece_id } = req.body || {}
  if (!piece_id) return err(res, 'Missing piece_id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(piece_id)) return err(res, 'Invalid piece_id')

  // Verify piece belongs to this workspace and load the fields the dispatcher needs.
  const ciRes = await sb(
    `content_items?id=eq.${piece_id}&${wsFilter}` +
    `&select=id,status,platform,content,media_urls,slides,scheduled_at,dispatch_state`
  )
  if (!ciRes.ok) return err(res, 'Database error', 500)
  const ciRows = await ciRes.json()
  if (!ciRows.length) return err(res, 'Content piece not found', 404)
  const piece = ciRows[0]

  // Terminal states: already scheduled/published — nothing to do.
  if (piece.status === 'scheduled' || piece.status === 'published') {
    return ok(res, { status: piece.status, alreadyApproved: true })
  }

  // draft/in_review → flip to approved. 'approved' (already approved but not yet
  // dispatched — e.g. a prior dispatch errored) falls through to retry dispatch.
  const APPROVABLE_STATUSES = new Set(['draft', 'in_review'])
  if (APPROVABLE_STATUSES.has(piece.status)) {
    const nowIso = new Date().toISOString()
    const patchRes = await sb(`content_items?id=eq.${piece_id}&${wsFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'approved', approved_by: auth.userId || 'unknown', approved_at: nowIso, updated_at: nowIso }),
    })
    if (!patchRes.ok) return err(res, 'Failed to approve piece', 500)
    piece.status = 'approved'
  } else if (piece.status !== 'approved') {
    return err(res, 'piece_not_ready', 422)
  }

  // Finish the job server-side: dispatch + schedule. On anything the server
  // can't dispatch (Buffer provider, carousel needing a bake), the client falls
  // back to its proven path; on a dispatch error, the piece stays approved and
  // the client surfaces it (never re-dispatches → no double-post).
  let dispatch
  try {
    dispatch = await dispatchContentItem({ ws, piece })
  } catch (e) {
    console.error('[content-plan/approve] dispatch threw:', e?.message)
    return ok(res, { status: 'approved', dispatched: false, error: 'dispatch_failed' })
  }

  if (dispatch?.dispatched) {
    return ok(res, { status: 'scheduled', dispatched: true, scheduledAt: dispatch.scheduledAt ?? null })
  }
  return ok(res, {
    status: 'approved',
    dispatched: false,
    ...(dispatch?.fallback ? { fallback: dispatch.fallback } : {}),
    ...(dispatch?.needs_client_bake ? { needs_client_bake: true } : {}),
    ...(dispatch?.reason ? { reason: dispatch.reason } : {}),
    ...(dispatch?.error ? { error: dispatch.error } : {}),
  })
}
