// Content items CRUD endpoint.
//
// Phase 1A security lockdown (2026-05-11): every request requires a verified
// Clerk JWT and every Supabase query is filtered by workspace. All inserts
// stamp the workspace_id from the resolved scope — callers cannot pass it in.

import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'

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

const SELECT = 'id,interview_id,clinician_id,clinician_name,topic,platform,content,status,scheduled_at,published_at,media_urls,platform_post_id,buffer_update_id,target_locations,location_id,notes,reviewed_by,approved_by,created_at,updated_at'

// Hard allowlist for PATCH — only these fields are written through. Prevents a
// caller from setting workspace_id, interview_id, or other denormalized keys
// that should be immutable post-create.
const PATCHABLE = new Set([
  'content',
  'status',
  'scheduled_at',
  'published_at',
  'media_urls',
  'platform_post_id',
  'buffer_update_id',
  'target_locations',
  'location_id',
  'reviewed_by',
  'approved_by',
  'notes',
  'updated_at',
])

const CAMEL_TO_SNAKE = {
  scheduledAt:     'scheduled_at',
  publishedAt:     'published_at',
  mediaUrls:       'media_urls',
  platformPostId:  'platform_post_id',
  bufferUpdateId:  'buffer_update_id',
  targetLocations: 'target_locations',
  locationId:      'location_id',
  reviewedBy:      'reviewed_by',
  approvedBy:      'approved_by',
  updatedAt:       'updated_at',
}

function normalizePatch(patch) {
  const out = {}
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) continue
    const key = CAMEL_TO_SNAKE[k] || k
    if (PATCHABLE.has(key)) out[key] = v
  }
  return out
}

export default async function handler(req, res) {
  const auth = await requireRole(req)
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  let scope
  try {
    scope = await workspaceScope(req)
  } catch {
    return res.status(404).json({ error: 'workspace-unresolved' })
  }
  const wsFilter = `${scope.column}=eq.${scope.id}`

  const { searchParams } = new URL(req.url, 'http://localhost')
  const id = searchParams.get('id')

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (id) {
      const r = await sb(`content_items?id=eq.${id}&${wsFilter}&select=${SELECT}`)
      if (!r.ok) return res.status(500).json({ error: 'Database error' })
      const data = await r.json()
      return res.status(200).json(data[0] ?? null)
    }

    const status      = searchParams.get('status')
    const platform    = searchParams.get('platform')
    const from        = searchParams.get('from')
    const to          = searchParams.get('to')
    const interviewId = searchParams.get('interviewId')
    const limit       = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

    let qs = `content_items?${wsFilter}&select=${SELECT}&order=created_at.desc&limit=${limit}`
    if (status)      qs += `&status=eq.${status}`
    if (platform)    qs += `&platform=eq.${platform}`
    if (from)        qs += `&scheduled_at=gte.${encodeURIComponent(from)}`
    if (to)          qs += `&scheduled_at=lte.${encodeURIComponent(to)}`
    if (interviewId) qs += `&interview_id=eq.${interviewId}`

    const r = await sb(qs)
    if (!r.ok) return res.status(500).json({ error: 'Database error' })
    return res.status(200).json(await r.json())
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body
    if (!body) return res.status(400).json({ error: 'Missing body' })

    // Build row payloads server-side — workspace_id always comes from scope.
    // Any client-supplied workspace_id is ignored.
    function rowFrom(raw) {
      return {
        [scope.column]:   scope.id,
        interview_id:     raw.interview_id    ?? raw.interviewId    ?? null,
        clinician_id:     raw.clinician_id    ?? raw.clinicianId    ?? null,
        clinician_name:   raw.clinician_name  ?? raw.clinicianName  ?? null,
        topic:            raw.topic ?? null,
        platform:         raw.platform,
        content:          raw.content,
        status:           raw.status || 'draft',
        media_urls:       raw.media_urls      ?? raw.mediaUrls      ?? [],
        location_id:      raw.location_id     ?? raw.locationId     ?? null,
        target_locations: raw.target_locations ?? raw.targetLocations ?? null,
      }
    }

    if (Array.isArray(body)) {
      const rows = body.map(rowFrom)
      for (const row of rows) {
        if (!row.platform || !row.content) {
          return res.status(400).json({ error: 'Missing required fields (platform, content)' })
        }
      }
      const r = await sb('content_items', { method: 'POST', body: JSON.stringify(rows) })
      if (!r.ok) return res.status(500).json({ error: 'Insert failed' })
      return res.status(201).json(await r.json())
    }

    const row = rowFrom(body)
    if (!row.interview_id || !row.platform || !row.content) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    const r = await sb('content_items', { method: 'POST', body: JSON.stringify(row) })
    if (!r.ok) return res.status(500).json({ error: 'Insert failed' })
    const data = await r.json()
    return res.status(201).json(data[0])
  }

  // ── PATCH ────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!id) return res.status(400).json({ error: 'Missing id' })

    // Verify row is in this workspace before patching. Without this guard, a
    // valid auth on workspace A could PATCH a row in workspace B by guessing
    // the UUID — the PATCH filter would silently match zero rows.
    const chk = await sb(`content_items?id=eq.${id}&${wsFilter}&select=id`)
    if (!chk.ok) return res.status(500).json({ error: 'Database error' })
    const rows = await chk.json()
    if (!rows.length) return res.status(404).json({ error: 'Not found' })

    const patch = normalizePatch(req.body)
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No patchable fields' })
    }

    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (!r.ok) return res.status(500).json({ error: 'Update failed' })
    const data = await r.json()
    return res.status(200).json(data[0])
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ error: 'Missing id' })

    const r = await sb(`content_items?id=eq.${id}&${wsFilter}`, { method: 'DELETE' })
    if (!r.ok) return res.status(500).json({ error: 'Delete failed' })
    return res.status(200).json({ deleted: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
