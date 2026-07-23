// PATCH /api/feedback/acknowledge
//
// Dismisses a fixed-report banner for the current user. Scoped to both
// workspace and the authenticated user id so one reporter can't dismiss
// another's notice.
//
// Body (JSON):
//   id   string  required — feedback row id (uuid)

import { requireRole }      from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)
  if (!wsCtx) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, null, { orgId: wsCtx.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { id } = req.body ?? {}
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })
  if (!auth.userId) return res.status(401).json({ error: 'no_user' })

  const r = await sb(
    `feedback?id=eq.${id}&workspace_id=eq.${wsCtx.id}&user_id=eq.${encodeURIComponent(auth.userId)}`,
    { method: 'PATCH', body: JSON.stringify({ acknowledged_at: new Date().toISOString() }) }
  )
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error('[feedback/acknowledge] update failed', r.status, body.slice(0, 500))
    return res.status(500).json({ error: 'update_failed' })
  }
  const saved = await r.json()
  if (!saved.length) return res.status(404).json({ error: 'not_found' })

  return res.status(200).json({ ok: true })
}

export const config = { runtime: 'nodejs' }
