// POST /api/content-plan/plan-week  { week: 'YYYY-MM-DD' }
//
// Generate-ahead (F2 week navigation). Composes a FUTURE week's plan NOW from the
// banked backlog (+ any captures already in that week's window), so the producer
// can review/approve early. Only future weeks (next .. +4) are plannable here:
//   • the current week auto-plans on capture completion + the weekly cron,
//   • past weeks are read-only.
// Idempotent — replanWorkspaceWeek uses replace-untouched, so re-running is safe
// and never clobbers human-edited / drafted atoms.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { replanWorkspaceWeek } from '../../_lib/strategistPlan.js'
import { mondayOf } from '../../_lib/strategist.js'

const NAV_FWD = 4
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  // Planning ahead is a producer action — gate to editor roles.
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const { week } = req.body || {}
  if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week) || mondayOf(week) !== week) {
    return err(res, 'Invalid week — must be a Monday (YYYY-MM-DD)')
  }
  const nowMonday = mondayOf(new Date().toISOString())
  const offsetWeeks = Math.round((Date.parse(week) - Date.parse(nowMonday)) / (7 * 86400000))
  if (offsetWeeks < 1 || offsetWeeks > NAV_FWD) {
    return err(res, 'Only future weeks (the next 4) can be planned ahead', 400)
  }

  try {
    const stats = await replanWorkspaceWeek({ workspace: ws, weekMonday: week })
    // No fresh captures in this future window AND no banked backlog to drip out —
    // nothing to compose yet. Surface it so the client can explain, not error.
    if (stats?.skipped === 'no-inputs') {
      return res.status(200).json({ planned: false, skipped: 'no-inputs', weekMonday: week })
    }
    return res.status(200).json({ planned: true, weekMonday: week, stats })
  } catch (e) {
    console.error('[content-plan/plan-week]', e.message, e.stack)
    return err(res, 'plan_ahead_failed', 500)
  }
}
