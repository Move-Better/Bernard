// GET /api/product-updates?role=producer
//
// ProducerHome's "What's new in Bernard" feed (P3). Reads the global,
// role-tagged product_updates table (migration 193), populated by
// scripts/generate-product-updates.mjs. Replaces the hand-maintained
// release-notes.json for role-targeted announcements — that file + the
// UpdateAvailableModal deploy-reload mechanism are unrelated and unaffected.
//
// product_updates is NOT workspace-scoped (Bernard ships one deployment for
// every tenant), so this route intentionally does not call workspaceContext —
// it only needs a valid authenticated session, same org-agnostic pattern as
// any other read that isn't tenant data.
export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const LIMIT = 20

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await requireRole(req, null, {})
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const role = String(req.query?.role || '').trim()

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/product_updates?select=id,created_at,summary,roles,page_hint` +
      `&order=created_at.desc&limit=${LIMIT}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!r.ok) {
      console.error('[product-updates] fetch failed:', r.status)
      return res.status(500).json({ error: 'db_error' })
    }
    const rows = (await r.json().catch(() => [])) || []
    // roles=[] means "everyone"; otherwise filter to rows tagged for this role.
    const filtered = role
      ? rows.filter((row) => !row.roles?.length || row.roles.includes(role))
      : rows
    return res.status(200).json({ updates: filtered })
  } catch (e) {
    console.error('[product-updates] error:', e?.message)
    return res.status(500).json({ error: 'db_error' })
  }
}
