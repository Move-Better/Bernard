// POST /api/content-plan/assign-slot — place a backlog atom into a specific
// posting slot (weekday + hour, this week's Monday). T3's "Place here" action
// from the Add-to-day picker.
//
// This is the ONE real gap the T3 grounding sweep found: today NOTHING can
// move a backlog item onto a specific day. PATCH /api/content-plan/atoms only
// toggles status (pending/skipped); PATCH /api/db/content can set scheduledAt
// on an already-drafted piece but that's a general content-item editor
// concern, not "place this atom in this slot" — and, before this PR, never
// cleared held_at. There was no endpoint at all for an undrafted backlog atom
// (no content_piece_id yet).
//
// Works for BOTH cases through the same code path, keyed on the atom (every
// atom has an id, drafted or not):
//   - undrafted atom (content_piece_id null) — just gets scheduled_at/plan_week
//     stamped and held_at cleared. It shows up on the board as "needs draft"
//     until someone drafts it (existing Draft-button flow).
//   - drafted atom (content_piece_id set) — same atom update, PLUS a
//     best-effort mirror onto its content_items row so the piece's own
//     scheduled_at agrees (matches the sync direction PATCH /api/db/content
//     already does the other way).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mondayOf, dateForWeekdaySlot } from '../../_lib/strategist.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WEEKDAY_CODES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])

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

  const { atomId, weekday, hour, weekMonday } = req.body || {}
  if (!atomId || !UUID_RE.test(atomId)) return err(res, 'Invalid atomId', 400)
  if (!WEEKDAY_CODES.has(weekday)) return err(res, 'Invalid weekday', 400)
  const hourNum = Number.isInteger(hour) ? hour : parseInt(hour, 10)
  if (!Number.isInteger(hourNum) || hourNum < 0 || hourNum > 23) return err(res, 'Invalid hour', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekMonday || '') || mondayOf(weekMonday) !== weekMonday) {
    return err(res, 'Invalid weekMonday — must be a Monday (YYYY-MM-DD)', 400)
  }

  const atomRes = await sb(`content_plan_atoms?id=eq.${atomId}&${wsFilter}&select=id,content_piece_id`)
  if (!atomRes.ok) return err(res, 'Database error', 500)
  const [atom] = await atomRes.json().catch(() => [])
  if (!atom) return err(res, 'Atom not found in workspace', 404)

  const timezone = ws.cadence_policy?.timezone || 'America/Los_Angeles'
  const scheduledAt = dateForWeekdaySlot(weekMonday, weekday, hourNum, timezone).toISOString()

  const atomPatchRes = await sb(`content_plan_atoms?id=eq.${atomId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({
      scheduled_at: scheduledAt,
      plan_week: weekMonday,
      held_at: null,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!atomPatchRes.ok) return err(res, 'Database error', 500)
  const [updatedAtom] = await atomPatchRes.json().catch(() => [])

  // Best-effort mirror onto the drafted piece, same direction PATCH
  // /api/db/content already mirrors the other way. A failure here must not
  // fail the placement — the atom (what /week actually renders from) is
  // already correct.
  if (atom.content_piece_id) {
    await sb(`content_items?id=eq.${atom.content_piece_id}&${wsFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ scheduled_at: scheduledAt, updated_at: new Date().toISOString() }),
    }).catch((e) => console.error('[assign-slot] content_items mirror failed:', e?.message))
  }

  return ok(res, updatedAtom ?? { id: atomId, scheduled_at: scheduledAt, plan_week: weekMonday })
}
