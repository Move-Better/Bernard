import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Create a new collection. Editor or admin only — clinicians don't curate
// collections. Slugs are derived from name when not provided; uniqueness is
// enforced at the DB layer (unique on brand+slug).

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

const ALLOWED_KINDS = new Set(['campaign', 'series', 'session', 'adhoc'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'name required' })

  const slug = slugify(body.slug || name) || null
  const kind = ALLOWED_KINDS.has(body.kind) ? body.kind : 'campaign'

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'generic', scope.workspace.id))) return

  // Verify cover_asset_id belongs to this workspace before binding it — the FK only
  // proves the id exists somewhere, not that it's this tenant's (mirrors the check
  // in collections/[id].js's PATCH path).
  let coverAssetId = null
  if (body.coverAssetId) {
    if (!UUID_RE.test(body.coverAssetId)) return res.status(400).json({ error: 'invalid_coverAssetId' })
    const assetChk = await sb(`media_assets?id=eq.${body.coverAssetId}&${scope.column}=eq.${scope.id}&select=id&limit=1`)
    const assetRows = assetChk.ok ? await assetChk.json().catch(() => []) : []
    if (!assetRows.length) return res.status(404).json({ error: 'cover_asset_not_found' })
    coverAssetId = body.coverAssetId
  }

  const row = {
    [scope.column]: scope.id,
    name,
    slug,
    description: body.description || null,
    kind,
    cover_asset_id: coverAssetId,
    status: 'active',
    created_by: auth.userId || null,
  }

  const r = await sb('collections', { method: 'POST', body: JSON.stringify(row) })
  if (!r.ok) {
    const text = await r.text()
    // 23505 = unique violation on (brand, slug).
    if (text.includes('23505')) {
      return res.status(409).json({ error: 'A collection with that slug already exists'})
    }
    return res.status(500).json({ error: 'Insert failed'})
  }
  const data = await r.json()
  return res.status(200).json(data[0] ?? null)
}

export default withSentry(handler)
