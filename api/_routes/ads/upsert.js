// POST /api/ads/upsert
//
// Save (insert or update) an exported ad creative for the /ads surface. Called
// by the export modals after a successful render. Node runtime + (req, res).
//
// Body: { id?, campaignId?, sourceAssetId?, sourcePieceId?, mediaType,
//         sizes:[{aspect,url,width,height}], caption?, title?, treatment? }
// Response 200: the saved row.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

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
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[ads/upsert] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await enforceLimit(req, res, 'media'))) return

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const b = req.body || {}
  const sizes = Array.isArray(b.sizes) ? b.sizes : null
  if (!sizes || sizes.length === 0) return res.status(400).json({ error: 'sizes_required' })

  // Validate any UUIDs that land in a filter or column.
  const id = b.id && UUID_RE.test(b.id) ? b.id : null
  const campaignId = b.campaignId && UUID_RE.test(b.campaignId) ? b.campaignId : null
  const sourceAssetId = b.sourceAssetId && UUID_RE.test(b.sourceAssetId) ? b.sourceAssetId : null
  const sourcePieceId = b.sourcePieceId && UUID_RE.test(b.sourcePieceId) ? b.sourcePieceId : null

  const fields = {
    campaign_id: campaignId,
    source_asset_id: sourceAssetId,
    source_piece_id: sourcePieceId,
    media_type: ['video', 'carousel'].includes(b.mediaType) ? b.mediaType : 'photo',
    sizes,
    caption: typeof b.caption === 'string' ? b.caption.slice(0, 2000) : null,
    title: typeof b.title === 'string' ? b.title.slice(0, 300) : null,
    treatment: (b.treatment && typeof b.treatment === 'object') ? b.treatment : null,
    updated_at: new Date().toISOString(),
  }

  let r
  if (id) {
    // Update — scoped to this workspace so a foreign id can't be touched.
    r = await sb(`ad_creatives?id=eq.${id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify(fields),
    })
  } else {
    r = await sb('ad_creatives', {
      method: 'POST',
      body: JSON.stringify({ ...fields, workspace_id: ws.id, created_by: auth.userId || null }),
    })
  }
  if (!r.ok) return dbErr(res, r)
  const rows = await r.json()
  return res.status(200).json(rows?.[0] || null)
}
