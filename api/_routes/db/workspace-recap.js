// Workspace weekly-recap aggregation — powers the Overview "This week" recap
// reviewed in the all-staff meeting. Returns team all-time/streak data and
// counted cost-usage units (things the client's capped useStories cache can't
// compute), via the workspace_recap() SQL function (migration 121). Dollars
// are applied client-side from src/lib/costEstimate.js.
//
// Node runtime + Express-style (req,res) — matches api/db/staff.js. A Web-style
// handler silently hangs on Vercel's Node runtime.
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  // Any authenticated member bound to this workspace's org. The Overview page
  // is editor-gated in the UI; the data here is workspace-scoped aggregate.
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const r = await sb('rpc/workspace_recap', {
    method: 'POST',
    body: JSON.stringify({ ws_id: ws.id }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[db/workspace-recap] rpc failed — supabase ${r.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const data = await r.json().catch(() => null)
  if (!data) return res.status(500).json({ error: 'Database error' })
  return res.status(200).json(data || { team: [], team_all_time_total: 0, cost: {} })
}
