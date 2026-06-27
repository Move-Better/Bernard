// Per-workspace usage summary — powers the /usage page (activity volume,
// stickiness, capture→publish funnel, per-staff breakdown). All numbers are
// aggregated from existing timestamps (interviews, content_items,
// media_assets) by the workspace_usage() SQL function (migration 147) — no
// new tracking. "Active day" = a day with any capture, draft, publish, or
// media write.
//
// Admin/owner only: the per-staff table exposes individual last-active and
// activity counts, so this is gated to the 'admin' role (org admins +
// internal-plan members + explicit publicMetadata.role=admin).
//
// Node runtime + Express-style (req,res) — matches api/_routes/db/workspace-recap.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const EMPTY = {
  stats: {
    active_days: { this_week: 0, prev_week: 0 },
    captures: { this_week: 0, prev_week: 0 },
    published: { this_week: 0, prev_week: 0 },
    media: { this_week: 0, prev_week: 0 },
  },
  activity: [],
  stickiness: {
    avg_active_days_per_week: 0, weekly_active_staff: 0, total_staff: 0,
    current_streak: 0, longest_streak: 0, active_days_by_week: [],
  },
  funnel: { captured: 0, drafted: 0, scheduled: 0, published: 0, avg_days_to_publish: null },
  staff: [],
}

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

  // Admin/owner only — the per-staff breakdown is mildly sensitive.
  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const weeksRaw = parseInt(new URL(req.url, 'http://localhost').searchParams.get('weeks'), 10)
  const n_weeks = Number.isFinite(weeksRaw) ? Math.min(Math.max(weeksRaw, 4), 26) : 12

  const r = await sb('rpc/workspace_usage', {
    method: 'POST',
    body: JSON.stringify({ ws_id: ws.id, n_weeks }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[db/workspace-usage] rpc failed — supabase ${r.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const data = await r.json().catch(() => null)
  return res.status(200).json(data || EMPTY)
}
