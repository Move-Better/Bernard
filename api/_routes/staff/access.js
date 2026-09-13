// POST /api/staff/access
//
// Switch a team member's access off or back on.
//
// Body:
//   { action: 'preview',    staffId, successorId }  → what would move, no writes
//   { action: 'deactivate', staffId, successorId }  → hand over open work, then switch off
//   { action: 'reactivate', staffId }               → switch back on
//
// Deactivating keeps the Clerk login, org membership, tier and every past
// stamp — see supabase/multitenant/migrations/216_staff_deactivation.sql. The
// person reaches nothing because requireRole refuses them (api/_lib/auth.js).
//
// Auth: members.invite (the Access page's own gate). Nobody can deactivate
// themselves or a workspace owner.

export const config = { runtime: 'nodejs' }

import { createClerkClient } from '@clerk/backend'
import { withSentry } from '../../_lib/sentry.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability, invalidateDeactivation } from '../../_lib/auth.js'
import { CAP_MEMBERS_INVITE } from '../../_lib/capabilities.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import { listWorkspaceOwnerUserIds } from '../../_lib/workspaceOwners.js'
import { planHandover, summarizePlan, applyHandover } from '../../_lib/teamAccess.js'

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
  return _clerk
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(['preview', 'deactivate', 'reactivate'])
const STAFF_SELECT = 'id,name,user_id,deactivated_at'

async function dbErr(res, r, msg) {
  const body = await r.text().catch(() => '')
  console.error(`[staff/access] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(500).json({ error: 'db_error' })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'workspace-not-resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const capAuth = await requireCapability(req, ws, [CAP_MEMBERS_INVITE])
  if (!capAuth.ok) return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { action, staffId, successorId } = req.body || {}
  if (!ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' })
  if (typeof staffId !== 'string' || !UUID_RE.test(staffId)) return res.status(400).json({ error: 'invalid_id' })

  const wsFilter = `workspace_id=eq.${ws.id}`
  const tr = await sb(`staff?id=eq.${staffId}&${wsFilter}&select=${STAFF_SELECT}`)
  if (!tr.ok) return dbErr(res, tr, 'target lookup failed')
  const [target] = await tr.json()
  if (!target) return res.status(404).json({ error: 'not_found' })

  if (action === 'reactivate') {
    if (!target.deactivated_at) return res.status(200).json({ ok: true, reactivated: false })
    const r = await sb(`staff?id=eq.${staffId}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({ deactivated_at: null, deactivated_by: null, updated_at: new Date().toISOString() }),
    })
    if (!r.ok) return dbErr(res, r, 'reactivate failed')
    if (target.user_id) invalidateDeactivation(target.user_id, ws.id)
    return res.status(200).json({ ok: true, reactivated: true })
  }

  // ── preview / deactivate ──────────────────────────────────────────────────
  if (target.user_id && target.user_id === auth.userId) {
    return res.status(400).json({ error: 'cannot_deactivate_self' })
  }
  if (target.deactivated_at) return res.status(409).json({ error: 'already_deactivated' })
  if (target.user_id) {
    const owners = await listWorkspaceOwnerUserIds(ws, sb, clerk, '[staff/access]')
    if (owners.has(target.user_id)) return res.status(400).json({ error: 'cannot_deactivate_owner' })
  }

  if (typeof successorId !== 'string' || !UUID_RE.test(successorId) || successorId === staffId) {
    return res.status(400).json({ error: 'invalid_successor' })
  }
  const sr = await sb(`staff?id=eq.${successorId}&${wsFilter}&select=${STAFF_SELECT}`)
  if (!sr.ok) return dbErr(res, sr, 'successor lookup failed')
  const [successor] = await sr.json()
  // The successor has to be someone who can actually sign in and act.
  if (!successor || successor.deactivated_at || !successor.user_id) {
    return res.status(400).json({ error: 'invalid_successor' })
  }

  let plan
  try {
    plan = await planHandover(sb, { workspaceId: ws.id, staffId })
  } catch (e) {
    console.error('[staff/access] handover plan failed:', e?.message)
    return res.status(500).json({ error: 'db_error' })
  }
  const successorOut = { id: successor.id, name: successor.name }
  if (action === 'preview') {
    return res.status(200).json({ counts: summarizePlan(plan), successor: successorOut })
  }

  // Hand over FIRST, switch off LAST: a failure part-way leaves the person
  // active with some work moved, and the same request can simply be retried.
  let counts
  try {
    counts = await applyHandover(sb, { workspaceId: ws.id, staffId, successor, plan })
  } catch (e) {
    console.error('[staff/access] handover failed:', e?.message)
    return res.status(500).json({ error: 'handover_failed' })
  }

  const dr = await sb(`staff?id=eq.${staffId}&${wsFilter}&deactivated_at=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({
      deactivated_at: new Date().toISOString(),
      deactivated_by: auth.userId,
      // The upload link works without a login, so it has to go now. A
      // reactivated person mints a fresh one from their profile.
      capture_upload_token: null,
      capture_upload_token_expires_at: null,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!dr.ok) return dbErr(res, dr, 'deactivate failed')
  if (target.user_id) invalidateDeactivation(target.user_id, ws.id)

  return res.status(200).json({ ok: true, deactivated: true, counts, successor: successorOut })
}

export default withSentry(handler)
