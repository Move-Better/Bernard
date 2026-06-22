// External article references attached to either a topic_backlog row
// (pre-interview reading) or a completed interview (post-interview source list).
// Display-only; `use_as_source` is a flag for a future AI-ingestion path.
//
// GET    /api/interview-references?topicId=X       — list refs for a topic
// GET    /api/interview-references?interviewId=X   — list refs for an interview
// POST   /api/interview-references                 — create one (body: { topicId|interviewId, url, title?, notes?, useAsSource? })
// PATCH  /api/interview-references?id=X            — update title/notes/useAsSource
// DELETE /api/interview-references?id=X            — remove
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
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

// Validate any id before interpolating into a PostgREST filter — a crafted value
// can inject extra filter params that alter which rows match within the caller's
// own workspace. (See api/_routes/db/content.js for the canonical pattern.)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT = 'id,workspace_id,topic_id,interview_id,url,title,notes,use_as_source,added_by,created_at,updated_at'

function normalizeUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  // Allow bare domains by prepending https://
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(candidate)
    if (!['http:', 'https:'].includes(u.protocol)) return null
    return u.toString()
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (req.method === 'GET') {
    if (!(await enforceLimit(req, res, 'read'))) return
    const topicId = searchParams.get('topicId')
    const interviewId = searchParams.get('interviewId')
    if (!topicId && !interviewId) return err(res, 'Missing topicId or interviewId')
    if (topicId && !UUID_RE.test(topicId)) return err(res, 'Invalid topicId', 400)
    if (interviewId && !UUID_RE.test(interviewId)) return err(res, 'Invalid interviewId', 400)

    let qs = `interview_references?${wsFilter}&select=${SELECT}&order=created_at.asc`
    if (topicId) qs += `&topic_id=eq.${topicId}`
    if (interviewId) qs += `&interview_id=eq.${interviewId}`
    const r = await sb(qs)
    if (!r.ok) {
      console.error(`[interview-references] GET ${r.status} ws=${ws.slug}`)
      return err(res, 'Database error', 500)
    }
    return ok(res, await r.json())
  }

  if (req.method === 'POST') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const body = req.body || {}
    const topicId = body.topicId || null
    const interviewId = body.interviewId || null
    if (!topicId === !interviewId) return err(res, 'Exactly one of topicId or interviewId is required')
    if (topicId && !UUID_RE.test(topicId)) return err(res, 'Invalid topicId', 400)
    if (interviewId && !UUID_RE.test(interviewId)) return err(res, 'Invalid interviewId', 400)

    const url = normalizeUrl(body.url)
    if (!url) return err(res, 'Valid URL required')

    // Verify the parent row belongs to this workspace before attaching.
    if (topicId) {
      const chk = await sb(`topic_backlog?id=eq.${topicId}&${wsFilter}&select=id&limit=1`)
      const rows = chk.ok ? await chk.json() : []
      if (!rows.length) return err(res, 'Topic not found', 404)
    } else {
      const chk = await sb(`interviews?id=eq.${interviewId}&${wsFilter}&select=id&limit=1`)
      const rows = chk.ok ? await chk.json() : []
      if (!rows.length) return err(res, 'Interview not found', 404)
    }

    const insert = {
      workspace_id: ws.id,
      topic_id: topicId,
      interview_id: interviewId,
      url,
      title: body.title ? String(body.title).trim().slice(0, 500) : null,
      notes: body.notes ? String(body.notes).trim().slice(0, 2000) : null,
      use_as_source: Boolean(body.useAsSource),
      added_by: body.addedBy || null,
    }
    const r = await sb('interview_references', { method: 'POST', body: JSON.stringify(insert) })
    if (!r.ok) {
      console.error(`[interview-references] POST ${r.status} ws=${ws.slug} body=${await r.text()}`)
      return err(res, 'Database error', 500)
    }
    const data = await r.json()
    return ok(res, data[0], 201)
  }

  if (req.method === 'PATCH') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')
    if (!UUID_RE.test(id)) return err(res, 'Invalid id', 400)

    const patch = req.body || {}
    const allowed = {}
    if (patch.title !== undefined) allowed.title = patch.title ? String(patch.title).trim().slice(0, 500) : null
    if (patch.notes !== undefined) allowed.notes = patch.notes ? String(patch.notes).trim().slice(0, 2000) : null
    if (patch.useAsSource !== undefined) allowed.use_as_source = Boolean(patch.useAsSource)
    if (patch.url !== undefined) {
      const u = normalizeUrl(patch.url)
      if (!u) return err(res, 'Valid URL required')
      allowed.url = u
    }
    if (Object.keys(allowed).length === 0) return err(res, 'No editable fields supplied')
    allowed.updated_at = new Date().toISOString()

    const r = await sb(`interview_references?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(allowed),
    })
    if (!r.ok) {
      console.error(`[interview-references] PATCH ${r.status} ws=${ws.slug}`)
      return err(res, 'Database error', 500)
    }
    const rows = await r.json()
    return ok(res, rows[0] ?? null)
  }

  if (req.method === 'DELETE') {
    if (!(await enforceLimit(req, res, 'write'))) return
    const id = searchParams.get('id')
    if (!id) return err(res, 'Missing id')
    if (!UUID_RE.test(id)) return err(res, 'Invalid id', 400)
    const r = await sb(`interview_references?id=eq.${id}&${wsFilter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    })
    if (!r.ok) {
      console.error(`[interview-references] DELETE ${r.status} ws=${ws.slug}`)
      return err(res, 'Database error', 500)
    }
    return ok(res, { ok: true })
  }

  return err(res, 'Method not allowed', 405)
}
