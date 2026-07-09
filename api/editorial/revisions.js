// GET/POST /api/editorial/revisions — editor version history (WS5).
//
//   GET  ?subjectType=video|slides&subjectId=<uuid>  → { revisions: [{id,label,created_at,doc}] }
//   POST { subjectType, subjectId, doc, label? }      → { id }  (prunes to the most recent 30)
//
// Auth: workspace-scoped (workspaceContext) + any authenticated member. Rows are
// filtered by workspace_id on every query (API-layer tenant isolation).

export const config = { runtime: 'nodejs' }

import { requireRole } from '../_lib/auth.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_KEEP = 30

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const params = new URL(req.url, 'http://localhost').searchParams
  const body = req.body || {}
  const subjectType = req.method === 'GET' ? String(params.get('subjectType') || '') : String(body.subjectType || '')
  const subjectId = req.method === 'GET' ? String(params.get('subjectId') || '') : String(body.subjectId || '')
  if (!['video', 'slides'].includes(subjectType)) return res.status(400).json({ error: 'invalid_subject_type' })
  if (!UUID_RE.test(subjectId)) return res.status(400).json({ error: 'invalid_subject_id' })

  const scope = `workspace_id=eq.${ws.id}&subject_type=eq.${subjectType}&subject_id=eq.${subjectId}`

  try {
    if (req.method === 'GET') {
      const r = await sb(`editor_revisions?${scope}&select=id,label,created_at,doc&order=created_at.desc&limit=${MAX_KEEP}`)
      if (!r.ok) { console.error('[revisions] list failed:', r.status); return res.status(500).json({ error: 'db_error' }) }
      return res.status(200).json({ revisions: await r.json() })
    }

    if (req.method === 'POST') {
      if (!body.doc || typeof body.doc !== 'object') return res.status(400).json({ error: 'invalid_doc' })
      const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null
      const ins = await sb('editor_revisions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ workspace_id: ws.id, subject_type: subjectType, subject_id: subjectId, doc: body.doc, label }),
      })
      if (!ins.ok) { console.error('[revisions] insert failed:', ins.status); return res.status(500).json({ error: 'db_error' }) }
      const [row] = await ins.json()
      // Prune everything older than the most recent MAX_KEEP for this subject.
      const older = await sb(`editor_revisions?${scope}&select=id&order=created_at.desc&offset=${MAX_KEEP}`)
      if (older.ok) {
        const rows = await older.json()
        if (rows.length) {
          const list = rows.map((o) => `"${o.id}"`).join(',')
          await sb(`editor_revisions?id=in.(${list})`, { method: 'DELETE' }).catch(() => {})
        }
      }
      return res.status(200).json({ id: row?.id })
    }

    return res.status(405).json({ error: 'method_not_allowed' })
  } catch (e) {
    console.error('[revisions] error:', e?.message)
    return res.status(500).json({ error: 'server_error' })
  }
}
