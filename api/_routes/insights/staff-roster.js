import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }

// GET /api/insights/staff-roster — the workspace's ACTIVE staff names, for a
// machine reader. Its one reader is Deep Thought's daily roster check, which
// flags anyone Deep Thought marks as former who is still active here (matched
// by name: Deep Thought records no Bernard id). 2026-11-15.
//
// Same wall as weekly-marketing.js and interview-count.js: the
// WEEKLY_MARKETING_KEY bearer (Sensitive) in constant time, only on the hosts in
// WEEKLY_MARKETING_WORKSPACES, workspace from workspaceScope(req), every query
// filtered by workspace_id, GET only, writes nothing. Names only: no email, no
// login id, no voice or capability fields leave Bernard.

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
    `staff?workspace_id=eq.${ws.id}&deactivated_at=is.null&archived_at=is.null&select=name,legal_name&order=name&limit=1000`,
    {}, { timeoutMs: 8_000 },
  )
  const rows = r.ok ? await r.json().catch(() => null) : null
  if (!Array.isArray(rows)) return res.status(502).json({ error: 'db_read_failed' })

  return res.status(200).json({
    workspace: ws.slug,
    active_staff: rows.map((s) => ({ name: s.name || null, legal_name: s.legal_name || null })),
    computed_at: new Date().toISOString(),
  })
}

export default withSentry(handler)
