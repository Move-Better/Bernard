// GET /api/db/moments?interview_id=<uuid>
//
// Read-only moment-bank listing for one interview (P2 of the moment-bank
// sprint) — powers the StoryDetail "Moments" section so Q can judge extraction
// quality before the planner (P3) depends on the bank. Embedding is never
// selected (1536 floats per row is pure payload weight for a list view).
//
// Auth: any workspace role; rows are workspace-filtered.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
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
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const url = new URL(req.url, 'http://localhost')
  const interviewId = url.searchParams.get('interview_id') || ''
  if (!UUID_RE.test(interviewId)) return res.status(400).json({ error: 'invalid_interview_id' })

  const r = await sb(
    `moments?workspace_id=eq.${ws.id}&interview_id=eq.${interviewId}` +
    `&select=id,excerpt,hook,moment_type,topic,region,tags,score,cluster_id,is_exemplar,status,usage_count,last_used_at,created_at` +
    `&order=score.desc.nullslast,created_at.asc`,
  )
  if (!r.ok) {
    console.error('[db/moments] query failed:', r.status, (await r.text().catch(() => '')).slice(0, 300))
    return res.status(500).json({ error: 'db_error' })
  }
  const moments = await r.json().catch(() => [])
  return res.status(200).json({ moments })
}
