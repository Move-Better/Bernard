// GBP Analytics endpoint — per-post view metrics for a GBP content item.
//
// Reads the latest engagement_snapshot with source='gbp' for the given
// content item. The cron (refresh-engagement) populates these snapshots
// by matching published GBP content items to local posts via the
// My Business reportInsights API and writing views into engagement_snapshots.
//
// Falls back gracefully when no snapshot exists yet.
// Returns { views, actions, fetchedAt } | { reason: 'no_data' }
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { requireRole }       from '../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { searchParams } = new URL(req.url, 'http://localhost')
  const contentItemId = searchParams.get('contentItemId')
  if (!contentItemId) return res.status(400).json({ error: 'Missing contentItemId' })
  if (!UUID_RE.test(contentItemId)) return res.status(400).json({ error: 'Invalid contentItemId' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'no-token' ? 401 : 403).json({ error: auth.reason })

  // Verify the item belongs to this workspace and is a GBP post
  const itemRes = await sb(
    `content_items?id=eq.${contentItemId}&workspace_id=eq.${ws.id}&select=id,platform,gbp_post_name,published_at&limit=1`
  )
  if (!itemRes.ok) return res.status(500).json({ error: 'Database error' })
  const items = await itemRes.json().catch(() => [])
  const item  = items?.[0]
  if (!item) return res.status(404).json({ error: 'Content item not found' })
  if (item.platform !== 'gbp') return res.status(200).json({ metrics: null, reason: 'not_gbp' })

  // Latest GBP engagement snapshot for this item
  const snapRes = await sb(
    `engagement_snapshots?content_item_id=eq.${contentItemId}&workspace_id=eq.${ws.id}&source=eq.gbp&order=fetched_at.desc&limit=1&select=stats,fetched_at`
  )
  const snaps = snapRes.ok ? (await snapRes.json().catch(() => [])) : []
  const snap  = snaps?.[0]

  if (!snap) {
    return res.status(200).json({
      metrics: null,
      reason: item.gbp_post_name ? 'pending_sync' : 'no_match',
    })
  }

  const views   = Number(snap.stats?.views)   || 0
  const actions = Number(snap.stats?.actions) || 0
  return res.status(200).json({ metrics: { views, actions }, fetchedAt: snap.fetched_at })
}
