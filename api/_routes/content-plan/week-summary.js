// GET /api/content-plan/week-summary  — the F2 post-call reveal (A.3) data.
// Returns the current week's Strategist plan summary for the workspace:
// what's scheduled this week (by platform + per-day), how many are banked as
// backlog, and the active digest contribution. Used by PostCallReveal.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  // Any authenticated workspace member can see their own post-call reveal.
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.error || 'Unauthorized', auth.status || 401)
  if (!(await enforceLimit(req, res, 'content-plan-week-summary'))) return

  const weekMonday = mondayOf(new Date().toISOString())

  // This week's planned atoms (Strategist output for plan_week). Full detail so
  // the /week calendar can render cards + drill in to the per-piece review.
  const ATOM_SELECT = 'id,platform,slot,scheduled_at,held_at,angle,angle_label,brief,status,content_piece_id,interview_id'
  const atomsRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${weekMonday}&select=${ATOM_SELECT}`,
  )
  const atoms = atomsRes.ok ? await atomsRes.json() : []
  const scheduled = atoms.filter((a) => a.scheduled_at)

  const byPlatform = {}
  for (const a of scheduled) {
    byPlatform[a.platform] = (byPlatform[a.platform] || 0) + 1
  }

  const shape = (a) => ({
    id: a.id,
    platform: a.platform,
    scheduled_at: a.scheduled_at,
    label: a.angle_label,
    brief: a.brief,
    status: a.status,
    contentPieceId: a.content_piece_id,
    interviewId: a.interview_id,
  })

  // Banked backlog (held across all weeks) — full list for the backlog rail.
  const heldRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&held_at=not.is.null&select=${ATOM_SELECT}&order=held_at.asc`,
  )
  const heldAtoms = heldRes.ok ? await heldRes.json() : []

  // Active digest (the newsletter contribution line) from the cadence policy.
  const digests = Array.isArray(ws.cadence_policy?.digests) ? ws.cadence_policy.digests : []
  const digest = digests.find((d) => d.enabled) || digests[0] || null

  return res.status(200).json({
    weekMonday,
    hasPlan: scheduled.length > 0,
    trustStage: ws.cadence_policy?.trust_stage || 'approve_all',
    cadence: ws.cadence_policy?.channels || null,
    quietDays: ws.cadence_policy?.quiet_days || ['sat', 'sun'],
    scheduledTotal: scheduled.length,
    byPlatform,
    scheduled: scheduled
      .map(shape)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)),
    heldCount: heldAtoms.length,
    held: heldAtoms.map(shape),
    digest: digest ? { label: digest.label, frequency: digest.frequency, next_send: digest.next_send || null } : null,
  })
}
