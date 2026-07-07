// Insights — Apple Business Connect (monthly recap uploads).
//
// Returns every stored monthly row for the workspace (all locations), newest
// month first, plus the latest month's headline for the summary tiles.
// Returns { connected: false } when the tenant has never uploaded a recap.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'insights-apple-performance', ws.id))) return

  const rowsRes = await sb(
    `apple_insights?workspace_id=eq.${ws.id}&order=period_month.desc&select=id,location_id,location_label,period_month,place_card_views,taps_from_search,directions,photos,website,call,views_yoy_pct,taps_yoy_pct,raw_extract,updated_at`
  )
  if (!rowsRes.ok) {
    const t = await rowsRes.text().catch(() => '')
    console.error('[insights/apple-performance] fetch failed:', rowsRes.status, t.slice(0, 300))
    return res.status(200).json({ connected: false, error: 'fetch_failed' })
  }
  const rows = await rowsRes.json().catch(() => [])
  if (!Array.isArray(rows) || rows.length === 0) return res.status(200).json({ connected: false })

  // Location labels for display (rows carry the parsed address; enrich with the
  // admin-facing workspace_locations label when the upload was bound to one).
  const locIds = [...new Set(rows.map((r) => r.location_id).filter(Boolean))]
  let locLabels = {}
  if (locIds.length) {
    const lr = await sb(
      `workspace_locations?id=in.(${locIds.join(',')})&workspace_id=eq.${ws.id}&select=id,label,city,region`
    )
    if (lr.ok) {
      const locs = await lr.json().catch(() => [])
      for (const l of locs) locLabels[l.id] = l.label || [l.city, l.region].filter(Boolean).join(', ')
    }
  }

  const shaped = rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    locationName: (r.location_id && locLabels[r.location_id]) || r.location_label || null,
    month: r.period_month,
    metrics: {
      placeCardViews: r.place_card_views,
      tapsFromSearch: r.taps_from_search,
      directions: r.directions,
      photos: r.photos,
      website: r.website,
      call: r.call,
    },
    yoy: {
      viewsPct: r.views_yoy_pct,
      tapsPct: r.taps_yoy_pct,
      interactions: r.raw_extract?.yoyInteractions || {},
    },
    updatedAt: r.updated_at,
  }))

  return res.status(200).json({
    connected: true,
    latestMonth: shaped[0]?.month || null,
    monthsCount: new Set(shaped.map((r) => r.month)).size,
    rows: shaped,
  })
}
