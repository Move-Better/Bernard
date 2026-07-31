// POST /api/producer/checkin-done
//
// Marks the periodic check-in as completed, which clears its checkpoint from
// the ProducerHome queue until the next interval elapses.
//
// This is the ONLY write in the check-in loop, and it is deliberately just a
// timestamp. The stay-auto / go-manual decision is NOT here: nothing can
// graduate yet, so a trust dial would be a control with nothing to control —
// and a decorative button in a surface about trust is worse than no button.
// When graduation exists, the decision joins this call rather than replacing it.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'write', ws.id))) return

  const at = new Date().toISOString()
  const r = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ last_checkin_at: at }),
  })
  if (!r.ok) {
    console.error('[producer/checkin-done] patch failed:', r.status, await r.text().catch(() => ''))
    return res.status(500).json({ error: 'checkin_write_failed' })
  }
  return res.status(200).json({ lastCheckinAt: at })
}
