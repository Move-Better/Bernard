import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }

// GET /api/insights/interview-count — how many interviews the workspace has
// completed, for a machine reader. Its one reader is the Move Better website,
// whose build shows the number as the homepage's "Doctor interviews" stat
// (it was typed by hand, 17 against 24 real, 2026-11-15).
//
// Same wall as weekly-marketing.js: `Authorization: Bearer <WEEKLY_MARKETING_KEY>`
// (Sensitive) in constant time, only on the hosts in WEEKLY_MARKETING_WORKSPACES,
// workspace from workspaceScope(req), every query filtered by workspace_id, GET
// only, writes nothing.
// ponytail: shares Deep Thought's key so the website holds a copy of it; give
// each reader its own key if either ever needs rotating on its own.

import { enforceLimit } from '../../_lib/ratelimit.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { supabaseRest } from '../../_lib/supabaseRest.js'
import { keyMatches } from '../media/catalogue.js'
import { WEEKLY_MARKETING_WORKSPACES } from './weekly-marketing.js'

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(404).json({ error: 'no_workspace' })
  const ws = scope.workspace
  if (!WEEKLY_MARKETING_WORKSPACES.has(ws?.slug)) return res.status(404).json({ error: 'not_found' })
  if (!keyMatches(req.headers?.authorization, process.env.WEEKLY_MARKETING_KEY)) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  if (!(await enforceLimit(req, res, 'generic', scope.id))) return

  const r = await supabaseRest(
    `interviews?workspace_id=eq.${ws.id}&status=eq.completed&select=id&limit=100000`,
    {}, { timeoutMs: 8_000 },
  )
  const rows = r.ok ? await r.json().catch(() => null) : null
  if (!Array.isArray(rows)) return res.status(502).json({ error: 'db_read_failed' })

  return res.status(200).json({
    workspace: ws.slug,
    completed_interviews: rows.length,
    computed_at: new Date().toISOString(),
  })
}

export default withSentry(handler)
