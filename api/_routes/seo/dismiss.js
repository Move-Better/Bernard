// POST /api/seo/dismiss  { query }
//
// Persist a dismissed SEO content opportunity so it stops showing in the /seo
// feed. Keyed by (workspace_id, query) — an upsert, so dismissing the same query
// twice is a no-op. Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'seo-dismiss'))) return

  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
  if (!query || query.length > 300) return res.status(400).json({ error: 'invalid_query' })

  const r = await fetch(`${SUPABASE_URL}/rest/v1/seo_opportunity_dismissals`, {
    method: 'POST',
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      // Upsert on the (workspace_id, query) unique constraint.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ workspace_id: ws.id, query, dismissed_by: auth.userId || null }),
  })

  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[seo/dismiss] insert failed:', r.status, text.slice(0, 200))
    return res.status(500).json({ error: 'dismiss_failed' })
  }

  return res.status(200).json({ ok: true })
}
