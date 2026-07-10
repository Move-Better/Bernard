// F18 — "What I noticed about you" Home card. Reads the CALLING user's own
// staff row (matched by Clerk user_id, not the whole workspace roster) so the
// card is personal, not a team aggregate. Pure read — no writes.
//
// Data is entirely pre-existing: staff.interview_style_memory (written by
// api/_lib/interviewStyleClassifier.js on interview completion) plus a count
// of this clinician's content_items published/scheduled in the trailing 7
// days. Renders nothing on the client when sessionCount is 0 — never
// fabricates a "noticed" line for a clinician with no interview history.
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

const SHIPPED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const SHIPPED_STATUSES = ['published', 'scheduled']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const staffRes = await sb(
    `staff?user_id=eq.${encodeURIComponent(auth.userId)}&workspace_id=eq.${ws.id}&select=id,name,interview_style_memory`
  )
  if (!staffRes.ok) {
    const body = await staffRes.text().catch(() => '')
    console.error(`[home/relationship-card] staff lookup failed — supabase ${staffRes.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const staffRows = await staffRes.json()
  const staff = staffRows[0]
  const mem = staff?.interview_style_memory
  const sessionCount = Number(mem?.sessionCount) || 0

  // No interview history yet — nothing to disclose. Render nothing rather
  // than an empty/placeholder card.
  if (!staff || sessionCount === 0) return res.status(200).json({ available: false })

  const sinceIso = new Date(Date.now() - SHIPPED_WINDOW_MS).toISOString()
  const shippedRes = await sb(
    `content_items?staff_id=eq.${staff.id}&workspace_id=eq.${ws.id}` +
      `&status=in.(${SHIPPED_STATUSES.join(',')})&updated_at=gte.${sinceIso}&select=id&limit=1`,
    { headers: { Prefer: 'count=exact' } }
  )
  if (!shippedRes.ok) {
    const body = await shippedRes.text().catch(() => '')
    console.error(`[home/relationship-card] shipped count failed — supabase ${shippedRes.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const range = shippedRes.headers.get('content-range') || ''
  const shippedThisWeek = parseInt(range.split('/')[1] || '0', 10) || 0

  // Only attribute angles to "this week" if the most recent logged session
  // actually happened in the trailing 7 days — sessions[] holds the last 3
  // regardless of age, so an older latest session should read as general
  // relationship context, not a fabricated "this week" claim.
  const sessions = Array.isArray(mem.sessions) ? mem.sessions : []
  const latestSession = sessions[sessions.length - 1] || null
  const latestIsThisWeek = !!latestSession?.at && Date.now() - new Date(latestSession.at).getTime() <= SHIPPED_WINDOW_MS
  const recentAngles = latestIsThisWeek && Array.isArray(latestSession.angles) ? latestSession.angles : []

  return res.status(200).json({
    available: true,
    staffName: staff.name,
    sessionCount,
    registerCeiling: mem.registerCeiling || null,
    recentAngles,
    recentAnglesThisWeek: latestIsThisWeek,
    shippedThisWeek,
  })
}
