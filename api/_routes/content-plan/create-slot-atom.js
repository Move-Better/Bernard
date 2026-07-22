// POST /api/content-plan/create-slot-atom — "Draft something new" for a
// genuinely EMPTY posting slot (no atom at all, not even an undrafted one).
// T3's Add-to-day picker (mockup screen 2: "Bernard writes a caption for this
// slot from your recent interviews").
//
// Scope decision: an empty slot has no interview attached, and
// POST /api/content-plan/draft hard-requires atom.interview_id (backlog atoms
// must be linked before drafting). Rather than replicate the Strategist's
// full angle/region-balance selection logic for a single ad-hoc slot, this
// picks the single MOST RECENT completed interview that doesn't already have
// an atom on this platform — a simple, honest heuristic (recency + no
// duplicate coverage), not the richer weekly-plan allocation. Creates a
// pending atom scoped to the requested slot; the caller then drafts it
// through the existing, unchanged /api/content-plan/draft — this endpoint
// only ever creates the atom, never generates content itself.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf, dateForWeekdaySlot } from '../../_lib/strategist.js'
import { ATOM_DEFINITIONS, defaultFormatForPlatform } from '../../_lib/atomPlan.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const WEEKDAY_CODES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
const SLOT_FORMATS = new Set(['post', 'reel', 'story'])
// How far back to look for a candidate interview. Matches strategist.js's own
// RECENT_TOPIC_DAYS window — a piece from further back is stale enough that
// "recent captures" no longer honestly describes it.
const CANDIDATE_WINDOW_DAYS = 30

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const wsFilter = `workspace_id=eq.${ws.id}`

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { platform, format, weekday, hour, weekMonday } = req.body || {}
  if (!platform || !ATOM_DEFINITIONS[platform]) return err(res, 'Invalid platform', 400)
  const fmt = SLOT_FORMATS.has(format) ? format : defaultFormatForPlatform(platform)
  if (!WEEKDAY_CODES.has(weekday)) return err(res, 'Invalid weekday', 400)
  const hourNum = Number.isInteger(hour) ? hour : parseInt(hour, 10)
  if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) return err(res, 'Invalid hour', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekMonday || '') || mondayOf(weekMonday) !== weekMonday) {
    return err(res, 'Invalid weekMonday — must be a Monday (YYYY-MM-DD)', 400)
  }

  // Interviews already carrying an atom on this platform — excluded so we
  // don't hand the operator a second angle on ground already covered.
  const coveredRes = await sb(`content_plan_atoms?${wsFilter}&platform=eq.${platform}&select=interview_id`)
  if (!coveredRes.ok) return err(res, 'Database error', 500)
  const covered = new Set((await coveredRes.json().catch(() => [])).map((r) => r.interview_id).filter(Boolean))

  const since = new Date(Date.now() - CANDIDATE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const ivRes = await sb(
    `interviews?${wsFilter}&status=in.(completed,synthesized)&created_at=gte.${since}` +
      `&select=id,topic,created_at&order=created_at.desc&limit=50`,
  )
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const interviews = await ivRes.json().catch(() => [])
  const candidate = interviews.find((iv) => !covered.has(iv.id))
  if (!candidate) {
    return err(res, 'no_eligible_interview', 422)
  }

  const angleDef = ATOM_DEFINITIONS[platform][0]
  const scheduledAt = dateForWeekdaySlot(weekMonday, weekday, hourNum, ws.cadence_policy?.timezone || 'America/Los_Angeles').toISOString()

  const insertRes = await sb('content_plan_atoms', {
    method: 'POST',
    body: JSON.stringify({
      interview_id: candidate.id,
      workspace_id: ws.id,
      platform,
      slot: 1,
      angle: angleDef.angle,
      angle_label: angleDef.label,
      angle_description: angleDef.description,
      brief: null,
      format: fmt,
      status: 'pending',
      planned_by: 'strategist',
      plan_week: weekMonday,
      scheduled_at: scheduledAt,
      held_at: null,
    }),
  })
  if (!insertRes.ok) return err(res, 'Database error', 500)
  const [atom] = await insertRes.json().catch(() => [])
  if (!atom) return err(res, 'Database error', 500)

  return ok(res, { atom, interview: { id: candidate.id, topic: candidate.topic } }, 201)
}
