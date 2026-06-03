// GET /api/editorial/proposal-counts
//
// Returns { counts: { [sourceAssetId]: number } } — the count of unreviewed
// (status='proposed') video_segments per source asset for the current workspace.
// Used by the Slate "Clips to review" tab to badge cards and populate the queue.
//
// Auth: any workspace role.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  // Fetch all proposed segments for this workspace in one query.
  const r = await sb(
    `video_segments?workspace_id=eq.${ws.id}&status=eq.proposed&select=source_asset_id`,
  )
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[proposal-counts] query failed:', r.status, text)
    return res.status(500).json({ error: 'db_error' })
  }

  const rows = await r.json().catch(() => [])
  const counts = {}
  for (const row of rows) {
    const id = row.source_asset_id
    if (id) counts[id] = (counts[id] || 0) + 1
  }

  return res.status(200).json({ counts })
}
