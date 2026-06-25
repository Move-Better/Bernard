// GET /api/ads/list
//
// Lists saved ad creatives for the current workspace, newest first, with the
// linked campaign embedded (for grouping on the /ads surface). Node runtime +
// (req, res) shape per CLAUDE.md.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
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
      ...init.headers,
    },
  })
}

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[ads/list] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const SELECT = [
  'id', 'campaign_id', 'source_asset_id', 'source_piece_id', 'media_type',
  'sizes', 'caption', 'title', 'created_at',
  'campaigns(id,name,status,event_at,end_at)',
].join(',')

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const r = await sb(
    `ad_creatives?workspace_id=eq.${ws.id}&select=${SELECT}&order=created_at.desc`,
  )
  if (!r.ok) return dbErr(res, r)
  const rows = await r.json()
  return res.status(200).json(Array.isArray(rows) ? rows : [])
}
