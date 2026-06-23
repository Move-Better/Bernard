// DELETE /api/ads/delete?id=<uuid>
//
// Remove a saved ad creative (the blob files are left in place — cheap, and a
// re-list won't show them). Node runtime + (req, res). Workspace-scoped delete.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

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
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforceLimit(req, res, 'media'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const url = new URL(req.url, 'http://localhost')
  const id = url.searchParams.get('id') || ''
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const r = await sb(`ad_creatives?id=eq.${id}&workspace_id=eq.${ws.id}`, { method: 'DELETE' })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[ads/delete] supabase ${r.status}: ${body.slice(0, 300)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  return res.status(200).json({ ok: true })
}
