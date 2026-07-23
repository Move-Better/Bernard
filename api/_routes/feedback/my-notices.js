// GET /api/feedback/my-notices
//
// Returns the current user's fixed-but-not-yet-acknowledged feedback reports,
// for the in-app "your reported issue was fixed" banner. Scoped to the
// authenticated Clerk user id, not just the workspace — a report is personal
// to whoever filed it.

import { requireRole }      from '../../_lib/auth.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)
  if (!wsCtx) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, null, { orgId: wsCtx.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!auth.userId) return res.status(200).json({ notices: [] })

  const q = `feedback?workspace_id=eq.${wsCtx.id}&user_id=eq.${encodeURIComponent(auth.userId)}` +
    `&resolved_at=not.is.null&acknowledged_at=is.null` +
    `&select=id,message,resolved_note,resolved_at&order=resolved_at.desc&limit=10`

  const r = await sb(q)
  if (!r.ok) {
    console.error('[feedback/my-notices] query failed', r.status)
    return res.status(500).json({ error: 'query_failed' })
  }
  const notices = await r.json()
  return res.status(200).json({ notices })
}

export const config = { runtime: 'nodejs' }
