// /api/practice-memory/supersessions
//
// GET   → list PENDING supersession candidates for the workspace (the confirm
//         queue). Each row: the older "before" claim + the newer "after" claim
//         the judge thinks supersedes it.
// PATCH → { id, action: 'confirm' | 'reject' }. confirm → the old chunk is
//         suppressed from retrieval; reject → dismissed (no effect). Nothing is
//         suppressed until the clinician confirms.

export const config = { runtime: 'nodejs' }

import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { sweepSupersededAnswers } from '../../_lib/sweepSupersededAnswers.js'

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

const ok = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (req.method === 'GET') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return
    const r = await sb(
      `practice_memory_supersessions?workspace_id=eq.${ws.id}&status=eq.pending` +
      '&select=id,old_source_label,new_source_label,old_excerpt,new_excerpt,confidence,rationale,detected_at' +
      '&order=detected_at.desc'
    )
    if (!r.ok) {
      console.error('[practice-memory/supersessions] list:', r.status, (await r.text().catch(() => '')).slice(0, 200))
      return err(res, 'db_error', 500)
    }
    return ok(res, await r.json())
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return
    const { id, action } = req.body || {}
    if (!UUID_RE.test(id || '')) return err(res, 'invalid_id', 400)
    if (action !== 'confirm' && action !== 'reject') return err(res, 'invalid_action', 400)

    const r = await sb(`practice_memory_supersessions?id=eq.${id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: action === 'confirm' ? 'confirmed' : 'rejected',
        resolved_at: new Date().toISOString(),
        resolved_by: auth.userId,
      }),
    })
    if (!r.ok) {
      console.error('[practice-memory/supersessions] patch:', r.status, (await r.text().catch(() => '')).slice(0, 200))
      return err(res, 'db_error', 500)
    }
    const [row] = await r.json()
    if (!row) return err(res, 'not_found', 404)

    // F16 Phase 3 — confirming a supersession means this clinician's thinking on a
    // topic changed. Sweep their PUBLISHED public answers on that topic, re-draft
    // the affected ones in the updated voice, and re-queue for review (the live
    // page stays up until they approve/retract). Runs after the response.
    if (action === 'confirm') {
      waitUntil(sweepSupersededAnswers({ ws, supersessionId: id }))
    }

    return ok(res, row)
  }

  return err(res, 'Method not allowed', 405)
}
