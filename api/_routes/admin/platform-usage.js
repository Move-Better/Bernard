// Cross-tenant platform usage — powers the super-admin /admin page (every
// workspace's adoption at a glance). Aggregated from existing timestamps by
// the platform_usage() SQL function (migration 148).
//
// Gated by requirePlatformAdmin: a USER-level Clerk flag
// (publicMetadata.platform_admin === true), NOT an org/workspace role. This
// is the one route that deliberately reads across all workspaces, so it does
// NOT call workspaceContext — there is no tenant to scope to. The platform-
// admin gate is the authorization boundary.
//
// Node runtime + Express-style (req,res).
export const config = { runtime: 'nodejs' }

import { requirePlatformAdmin } from '../../_lib/auth.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const EMPTY = {
  topline: { workspaces: 0, active_this_week: 0, captures_week: 0, published_week: 0, at_risk: 0 },
  workspaces: [],
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await requirePlatformAdmin(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/platform_usage`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    console.error(`[admin/platform-usage] rpc failed — supabase ${r.status}: ${body.slice(0, 500)}`)
    return res.status(500).json({ error: 'Database error' })
  }
  const data = await r.json().catch(() => null)
  return res.status(200).json(data || EMPTY)
}
