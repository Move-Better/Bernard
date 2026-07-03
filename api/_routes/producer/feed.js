// GET /api/producer/feed?limit=&offset=
//
// The read behind "Bernard's workday" (/producer page + the /week strip).
// Returns the workspace's agent_actions newest-first — the append-only ledger
// of what the Standing Producer has done (Phase 0: narration of existing
// events; later phases: autonomous actions).
//
// Returns { enabled: false, actions: [] } when the workspace hasn't hired
// Bernard (producer_config.enabled), so the UI can render an honest empty
// state without a second config round-trip. Any workspace member can read.
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const DEFAULT_LIMIT = 30
const MAX_LIMIT     = 100

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
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
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'producer-feed', ws.id))) return

  const enabled = Boolean(ws.producer_config?.enabled)
  if (!enabled) return res.status(200).json({ enabled: false, actions: [] })

  const url    = new URL(req.url, 'http://localhost')
  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || DEFAULT_LIMIT))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0)

  const r = await sb(
    `agent_actions?workspace_id=eq.${ws.id}` +
    `&select=id,kind,title,detail,content_item_id,atom_id,interview_id,model,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`
  )
  if (!r.ok) {
    console.error('[producer/feed] fetch failed:', r.status)
    return res.status(500).json({ error: 'feed_fetch_failed' })
  }
  const actions = await r.json().catch(() => [])

  return res.status(200).json({
    enabled: true,
    actions,
    pausedAt: ws.producer_config?.paused_at ?? null,
    hasMore: Array.isArray(actions) && actions.length === limit,
  })
}
