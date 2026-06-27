// Add / remove a visual anchor on workspaces.brand_brief.visualAnchors.
// User-curated references (screenshots + handles) layered on top of the
// interview-derived anchors. Founder-only; workspace-scoped. Read-modify-write
// on the JSONB column (single-admin settings surface — no concurrent-edit fence
// beyond the workspace filter).
export const config = { runtime: 'nodejs' }

import { randomUUID } from 'node:crypto'
import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

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

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[brand-discovery/anchors] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

const MAX_ANCHORS = 12
const clip = (s, n) => String(s || '').trim().slice(0, n)

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason, auth.reason === 'forbidden' ? 403 : 401)

  if (req.method !== 'POST' && req.method !== 'DELETE') return err(res, 'Method not allowed', 405)
  if (!(await enforceLimit(req, res, 'media'))) return

  // Load the current brief. Anchors live on it; refuse if there's no brief yet.
  const loadR = await sb(`workspaces?id=eq.${ws.id}&select=brand_brief`)
  if (!loadR.ok) return dbErr(res, loadR, 'Load failed')
  const brief = (await loadR.json())[0]?.brand_brief
  if (!brief || typeof brief !== 'object') return err(res, 'no_brief', 409)
  const anchors = Array.isArray(brief.visualAnchors) ? brief.visualAnchors : []

  let next
  if (req.method === 'POST') {
    const { reference, why, imageUrl } = req.body || {}
    const ref = clip(reference, 200)
    const note = clip(why, 400)
    const img = typeof imageUrl === 'string' && /^https?:\/\//i.test(imageUrl) ? imageUrl.trim() : null
    if (!ref && !img) return err(res, 'Provide a reference or an image')
    if (anchors.length >= MAX_ANCHORS) return err(res, 'anchor_limit_reached', 409)
    const anchor = {
      id: randomUUID(),
      reference: ref || 'Reference',
      why: note,
      ...(img ? { imageUrl: img } : {}),
      source: 'user',
    }
    next = [...anchors, anchor]
  } else {
    // DELETE — by anchorId when present, else by array index.
    const { searchParams } = new URL(req.url, 'http://localhost')
    const anchorId = searchParams.get('anchorId')
    const idxRaw = searchParams.get('index')
    if (anchorId) {
      next = anchors.filter((a) => a?.id !== anchorId)
      if (next.length === anchors.length) return err(res, 'not_found', 404)
    } else if (idxRaw != null && /^\d+$/.test(idxRaw)) {
      const idx = parseInt(idxRaw, 10)
      if (idx < 0 || idx >= anchors.length) return err(res, 'not_found', 404)
      next = anchors.filter((_, i) => i !== idx)
    } else {
      return err(res, 'Missing anchorId or index')
    }
  }

  const nextBrief = { ...brief, visualAnchors: next }
  const patchR = await sb(`workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ brand_brief: nextBrief }),
  })
  if (!patchR.ok) return dbErr(res, patchR, 'Update failed')
  invalidateWorkspaceCacheById(ws.id)
  invalidateWorkspaceCacheBySlug(ws.slug)

  return ok(res, { ok: true, visualAnchors: next })
}
