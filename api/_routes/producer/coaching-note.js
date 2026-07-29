// GET /api/producer/coaching-note
//
// ProducerHome's "Bernard's note for this week" card (P4). Reads the cached
// weekly note written by scripts/generate-coaching-note.mjs (one per
// workspace per week — workspace_coaching_notes, migration 193). This route
// never generates a note itself — a scheduled job does, so every producer
// gets the same read-latency-free card, and generation cost isn't paid on
// every page load.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/workspace_coaching_notes?workspace_id=eq.${ws.id}` +
      `&select=note,week_monday,created_at&order=week_monday.desc&limit=1`,
      {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!r.ok) {
      console.error('[producer/coaching-note] fetch failed:', r.status)
      return res.status(500).json({ error: 'db_error' })
    }
    const rows = (await r.json().catch(() => [])) || []
    return res.status(200).json({ note: rows[0] || null })
  } catch (e) {
    console.error('[producer/coaching-note] error:', e?.message)
    return res.status(500).json({ error: 'db_error' })
  }
}
