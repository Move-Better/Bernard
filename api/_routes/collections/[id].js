import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET / PATCH / DELETE for a single collection.
//   GET    → any authenticated user; embeds the asset list (id, blob_url,
//            thumbnail_url, kind, status, filename) so the detail view can
//            render without a second hop.
//   PATCH  → admin or publisher; rename, re-describe, change cover, archive.
//   DELETE → admin or publisher; cascades collection_items but leaves assets.

import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceScope } from '../../_lib/workspaceScope.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ROLE_REQUIREMENTS = {
  GET:    null,
  PATCH:  EDITOR_ROLES,
  DELETE: EDITOR_ROLES,
}

const ALLOWED_KINDS    = new Set(['campaign', 'series', 'session', 'adhoc'])
const ALLOWED_STATUSES = new Set(['active', 'archived'])

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

const SELECT_COMMON =
  'name,slug,description,kind,cover_asset_id,status,' +
  'created_at,updated_at,created_by,' +
  'collection_items(asset_id,position,added_at,added_by,' +
  'media_assets(id,kind,status,filename,blob_url,thumbnail_url,duration_s,aspect_ratio))'

async function handler(req, res) {
  if (!(req.method in ROLE_REQUIREMENTS)) {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const url = new URL(req.url, 'http://localhost')
  const id  = url.pathname.split('/').pop()
  if (!id) return res.status(400).json({ error: 'Missing id' })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const scope = await workspaceScope(req)
  if (!scope) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, ROLE_REQUIREMENTS[req.method], { orgId: scope.workspace.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  const SELECT = `id,${scope.column},${SELECT_COMMON}`
  const where = `id=eq.${id}&${scope.column}=eq.${scope.id}`

  if (req.method === 'GET') {
    const r = await sb(`collections?${where}&select=${SELECT}`)
    if (!r.ok) {
      console.error('[[id].js] db error:', r.status)
      return res.status(500).json({ error: 'Database error'})
    }
    const rows = await r.json()
    const row  = rows[0]
    if (!row) return res.status(404).json({ error: 'Not found' })

    // Flatten the embedded items into a clean array of assets with item meta.
    const items = (row.collection_items || [])
      .map((ci) => ({
        asset_id: ci.asset_id,
        position: ci.position,
        added_at: ci.added_at,
        added_by: ci.added_by,
        asset:    ci.media_assets || null,
      }))
      .sort((a, b) => {
        const ap = a.position ?? Number.POSITIVE_INFINITY
        const bp = b.position ?? Number.POSITIVE_INFINITY
        if (ap !== bp) return ap - bp
        return new Date(a.added_at) - new Date(b.added_at)
      })

    const { collection_items: _ci, ...rest } = row
    return res.status(200).json({ ...rest, items, item_count: items.length })
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'generic', scope.workspace.id))) return
    const patch = req.body || {}

    // Verify cover_asset_id belongs to this workspace before binding it.
    if (patch.coverAssetId) {
      if (!UUID_RE.test(patch.coverAssetId)) return res.status(400).json({ error: 'invalid_coverAssetId' })
      const assetChk = await sb(`media_assets?id=eq.${patch.coverAssetId}&${scope.column}=eq.${scope.id}&select=id&limit=1`)
      if (!assetChk.ok || !(await assetChk.json()).length) {
        return res.status(404).json({ error: 'cover_asset_not_found' })
      }
    }

    const allowed = {
      name:           patch.name,
      slug:           patch.slug,
      description:    patch.description,
      kind:           patch.kind && ALLOWED_KINDS.has(patch.kind)       ? patch.kind   : undefined,
      cover_asset_id: patch.coverAssetId,
      status:         patch.status && ALLOWED_STATUSES.has(patch.status) ? patch.status : undefined,
    }
    const body = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
    if (Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'No editable fields in patch' })
    }

    const r = await sb(`collections?${where}`, {
      method: 'PATCH',
      body:   JSON.stringify(body),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[collections/patch] supabase error:', text.slice(0, 300))
      if (text.includes('23505')) {
        return res.status(409).json({ error: 'A collection with that slug already exists' })
      }
      return res.status(500).json({ error: 'Update failed' })
    }
    const data = await r.json()
    return res.status(200).json(data[0] ?? null)
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'generic', scope.workspace.id))) return
    const r = await sb(`collections?${where}`, { method: 'DELETE' })
    if (!r.ok) {
      console.error('[[id].js] db error:', r.status)
      return res.status(500).json({ error: 'Delete failed'})
    }
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
