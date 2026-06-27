// GET/POST/PATCH /api/db/briefs — CRUD for the briefs table.
// Briefs are workspace-scoped; all ops filter by workspace_id.
export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })
function dbErr(res, r, msg) {
  console.error(`[db/briefs] ${msg}`, r.status)
  return res.status(502).json({ error: msg })
}

async function handler(req, res) {
  const ws   = await workspaceContext(req)
  if (!ws) return res.status(401).json({ error: 'Workspace not found' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const id       = req.query.id || null
  if (id && !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })
  const wsFilter = `workspace_id=eq.${ws.id}`

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`briefs?id=eq.${id}&${wsFilter}&select=*`)
      if (!r.ok) return dbErr(res, r, 'Fetch failed')
      const rows = await r.json()
      if (!rows.length) return res.status(404).json({ error: 'Not found' })
      return ok(res, rows[0])
    }
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200)
    const r = await sb(`briefs?${wsFilter}&select=*&order=created_at.desc&limit=${limit}`)
    if (!r.ok) return dbErr(res, r, 'Fetch failed')
    return ok(res, await r.json())
  }

  const BRIEF_VALID_STATUSES = new Set(['done', 'draft', 'archived'])

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'media', ws.id))) return
    const { title, body, eventAt, location, ctaUrl, ctaLabel, mediaUrl, selectedOutputs, status } = req.body || {}
    if (!title || !body) return err(res, 'title and body are required')
    if (status != null && !BRIEF_VALID_STATUSES.has(status)) return err(res, 'invalid_status')
    const row = {
      workspace_id:     ws.id,
      title,
      body,
      event_at:         eventAt    || null,
      location:         location   || null,
      cta_url:          ctaUrl     || null,
      cta_label:        ctaLabel   || null,
      media_url:        mediaUrl   || null,
      selected_outputs: selectedOutputs || [],
      status:           status     || 'done',
    }
    const r = await sb('briefs', { method: 'POST', body: JSON.stringify(row) })
    if (!r.ok) return dbErr(res, r, 'Insert failed')
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!id) return err(res, 'Missing id')
    const patch = req.body || {}
    const allowed = {
      title:            patch.title,
      body:             patch.body,
      event_at:         patch.eventAt,
      location:         patch.location,
      cta_url:          patch.ctaUrl,
      cta_label:        patch.ctaLabel,
      media_url:        patch.mediaUrl,
      selected_outputs: patch.selectedOutputs,
      ...(patch.status != null && BRIEF_VALID_STATUSES.has(patch.status) ? { status: patch.status } : {}),
    }
    const update = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))
    if (!Object.keys(update).length) return err(res, 'Nothing to update')
    const r = await sb(`briefs?id=eq.${id}&${wsFilter}`, { method: 'PATCH', body: JSON.stringify(update) })
    if (!r.ok) return dbErr(res, r, 'Update failed')
    return ok(res, await r.json())
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

export default withSentry(handler)
