// DELETE /api/music/<id>  — remove one of THIS workspace's own tracks
// PATCH  /api/music/<id>  — edit its title / mood
//
// Admins only. Scoped to `workspace_id = eq.<ws.id>`, so a shared track
// (workspace_id IS NULL) can never match — tenants can't delete/edit the shared
// library, only their own uploads (WS3.3-P2).

export const config = { runtime: 'nodejs' }

import { withSentry } from '../../_lib/sentry.js'
import { del as blobDel } from '@vercel/blob'
import { requireRole } from '../../_lib/auth.js'
import { ADMIN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { MUSIC_MOODS } from '../../_lib/musicLibrary.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sb(path, init = {}) {
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

async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const url = new URL(req.url, 'http://localhost')
  const segments = url.pathname.split('/').filter(Boolean)
  const id = segments[segments.length - 1]
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ADMIN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  // Only this workspace's OWN tracks are addressable — the workspace_id filter
  // excludes shared (NULL) rows entirely.
  const scoped = `music_tracks?id=eq.${id}&workspace_id=eq.${ws.id}`

  if (req.method === 'DELETE') {
    // Grab the blob url first so we can best-effort clean up the file too.
    const found = await sb(`${scoped}&select=blob_url`)
    const rows = found.ok ? await found.json() : []
    if (!rows.length) return res.status(404).json({ error: 'not_found' })
    const r = await sb(scoped, { method: 'DELETE' })
    if (!r.ok) { console.error('[music/[id]] delete failed:', r.status); return res.status(500).json({ error: 'delete_failed' }) }
    if (rows[0]?.blob_url) blobDel(rows[0].blob_url).catch((e) => console.error('[music/[id]] blob del failed:', e?.message))
    return res.status(200).json({ ok: true })
  }

  // PATCH — title / mood only.
  const body = req.body || {}
  const patch = {}
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120)
  if (MUSIC_MOODS.includes(body.mood)) patch.mood = body.mood
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing_to_update' })

  const r = await sb(scoped, { method: 'PATCH', body: JSON.stringify(patch) })
  if (!r.ok) { console.error('[music/[id]] patch failed:', r.status); return res.status(500).json({ error: 'update_failed' }) }
  const updated = await r.json()
  if (!updated.length) return res.status(404).json({ error: 'not_found' })
  return res.status(200).json({ ok: true, track: updated[0] })
}

export default withSentry(handler)
