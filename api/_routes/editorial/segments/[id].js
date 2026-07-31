// PATCH /api/editorial/segments/:id
//
// Multi-clip video v1 (Phase 2). Updates the review status of one proposed
// segment — keep or discard — from the Moment Miner segment picker. Rendering a kept
// segment is a separate step (POST /api/editorial/render-segments), so this
// endpoint only moves review state.
//
// Body:
//   { status: 'kept' | 'discarded' | 'proposed',
//     discardReasons?: string[], discardNote?: string }
//
// The reason fields are only meaningful alongside status='discarded' and are
// ignored otherwise — a keep carries no rejection reason. Both are optional:
// denying without saying why still denies (same contract as moment Retire).
//
// Auth: Clerk JWT + workspace org-id.
// Only the owning workspace's segments are accessible.
//
// Responses: 200 { segment } / 400 / 401 / 403 / 404 / 409 / 500

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../../_lib/roles.js'
import { workspaceContext } from '../../../_lib/workspaceContext.js'
import { enforceLimit } from '../../../_lib/ratelimit.js'
import { CLIP_DISCARD_REASON_KEYS, CLIP_DISCARD_NOTE_MAX } from '../../../../src/lib/clipDiscard.js'

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

// Review-state transitions a clinician may make from the picker. 'rendered' is
// terminal and only set by the render path, so it isn't allowed here.
const ALLOWED_STATUS = new Set(['kept', 'discarded', 'proposed'])

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const id = url.pathname.split('/').at(-1)
  if (!id || id === 'segments') {
    return res.status(400).json({ error: 'missing_id' })
  }
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }
  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const body = req.body || {}
  const status = String(body.status || '')
  if (!ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...ALLOWED_STATUS] })
  }

  // Reason capture (migration 202). Validated against the shared vocabulary in
  // src/lib/clipDiscard.js so an unknown key 400s here rather than landing in
  // the column as a value no reader will ever recognise.
  let discardReasons = null
  let discardNote = null
  if (status === 'discarded') {
    if (body.discardReasons !== undefined && body.discardReasons !== null) {
      if (!Array.isArray(body.discardReasons)) {
        return res.status(400).json({ error: 'invalid_discard_reasons' })
      }
      const bad = body.discardReasons.filter((r) => !CLIP_DISCARD_REASON_KEYS.has(r))
      if (bad.length) {
        return res.status(400).json({ error: 'invalid_discard_reasons', allowed: [...CLIP_DISCARD_REASON_KEYS] })
      }
      // De-dupe so a double-tapped chip doesn't skew any future rollup.
      discardReasons = [...new Set(body.discardReasons)]
    }
    if (body.discardNote !== undefined && body.discardNote !== null) {
      if (typeof body.discardNote !== 'string') {
        return res.status(400).json({ error: 'invalid_discard_note' })
      }
      discardNote = body.discardNote.trim().slice(0, CLIP_DISCARD_NOTE_MAX) || null
    }
  }

  // Don't let a review toggle stomp a segment that's already been rendered into
  // a package — that's terminal.
  const cur = await sb(
    `video_segments?id=eq.${id}&workspace_id=eq.${ws.id}&select=id,status,story_package_id`,
  )
  if (!cur.ok) return res.status(500).json({ error: 'db_error' })
  const existing = (await cur.json())?.[0]
  if (!existing) return res.status(404).json({ error: 'segment_not_found' })
  if (existing.status === 'rendered' || existing.story_package_id) {
    return res.status(409).json({ error: 'already_rendered' })
  }

  // Un-denying (back to proposed/kept) clears the reasons — leaving them behind
  // would attach a rejection to a segment nobody is rejecting any more.
  const patch = status === 'discarded'
    ? { status, discard_reasons: discardReasons, discard_note: discardNote }
    : { status, discard_reasons: null, discard_note: null }

  const patchRes = await sb(`video_segments?id=eq.${id}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!patchRes.ok) return res.status(500).json({ error: 'db_error' })
  const updated = (await patchRes.json())?.[0]

  return res.status(200).json({ segment: updated })
}
