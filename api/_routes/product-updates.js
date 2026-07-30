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
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const auth = await requireRole(req, null, {})
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic'))) return

  const role = String(req.query?.role || '').trim()
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query?.limit) || DEFAULT_LIMIT))
  const offset = Math.max(0, Number(req.query?.offset) || 0)

  // Filtering by role happens client-of-postgrest side (roles=[] means
  // "everyone", so it can't be expressed as a single PostgREST predicate) —
  // fetch a role-agnostic page and filter after. This means a role-scoped
  // page can come back shorter than `limit` even when more rows exist; the
  // client's "load more" just keeps asking for the next offset until a
  // genuinely short page appears, same as any other role-agnostic feed.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/product_updates?select=id,created_at,summary,roles,page_hint` +
      `&order=created_at.desc&limit=${limit}&offset=${offset}`,
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
    return res.status(200).json({ updates: filtered, pageSize: rows.length })
  } catch (e) {
    console.error('[product-updates] error:', e?.message)
    return res.status(500).json({ error: 'db_error' })
  }
}
