// GET /api/db/workspace-week?weekOffset=0 — one selected calendar week
// (Mon–Sun UTC) of Overview recap facts, via the workspace_week_recap() SQL
// function (migration 175): published/captured/drafted counts + prev-week
// counterparts (delta chips), cost units for both weeks, the week's
// published/captured item lists, and a scored top post.
//
// The RPC returns each published item's latest engagement snapshot raw
// (top_candidates); this handler scores them with the shared scoreSnapshot()
// so the per-source field mapping stays in exactly one place
// (api/_lib/engagementScoring.js), then strips the raw stats from the
// response.
//
// Node runtime + Express-style (req,res) — matches api/db/workspace-recap.js.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { scoreSnapshot } from '../../_lib/engagementScoring.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Matches the SQL-side clamp: 0 = this week, negative = past weeks, at most
// 20 years back (sanity bound, not a product limit — the UI floors at the
// workspace's first_week from workspace_recap()).
const MIN_OFFSET = -1040

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

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const { searchParams } = new URL(req.url, 'http://localhost')
  const raw = searchParams.get('weekOffset') ?? '0'
  if (!/^-?\d{1,4}$/.test(raw)) return res.status(400).json({ error: 'invalid_week_offset' })
  const weekOffset = Math.max(MIN_OFFSET, Math.min(0, Number.parseInt(raw, 10)))

  const r = await sb('rpc/workspace_week_recap', {
    method: 'POST',
    body: JSON.stringify({ ws_id: ws.id, wk_offset: weekOffset }),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[db/workspace-week] rpc failed — supabase ${r.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const data = await r.json().catch(() => null)
  if (!data) return res.status(500).json({ error: 'Database error' })

  // Score the raw snapshot candidates into a single top post (score > 0 only —
  // an all-zero or unavailable snapshot never counts as "top").
  let topPost = null
  for (const cand of data.top_candidates || []) {
    const { score, reach, pageviews, engagement } = scoreSnapshot(cand)
    if (score <= 0) continue
    if (!topPost || score > topPost.score) {
      topPost = {
        topic: cand.topic || 'Untitled',
        platform: cand.platform,
        source: cand.source,
        score,
        reach,
        pageviews,
        engagement,
      }
    }
  }
  delete data.top_candidates

  return res.status(200).json({ ...data, week_offset: weekOffset, top_post: topPost })
}
