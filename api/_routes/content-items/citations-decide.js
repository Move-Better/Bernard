// PATCH /api/content-items/citations-decide  { citationId, decision }
//
// The human gate itself. decision is 'approved' or 'rejected' — nothing else.
// Only 'approved' rows are ever inserted into a published post
// (api/_lib/citations/insertCitations.js, Phase 4); 'rejected' rows are kept
// (never deleted) as the audit trail the spec calls for, and the unique
// (content_item_id, source_url) index means a rejected source won't be
// re-proposed on a later "find supporting research" re-run.
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES — this is the same
// approve/reject trust boundary as the publish flow it feeds.
//
// Response 200: { citation: {...updated row...} }
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace / row), 500.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_DECISIONS = new Set(['approved', 'rejected'])

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
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const body = req.body || {}
  const citationId = body.citationId ? String(body.citationId) : null
  const decision = body.decision ? String(body.decision) : null
  if (!citationId || !UUID_RE.test(citationId)) return res.status(400).json({ error: 'invalid_citation_id' })
  if (!decision || !VALID_DECISIONS.has(decision)) return res.status(400).json({ error: 'invalid_decision' })

  // Scoped by workspace_id — a caller can't decide another tenant's row even
  // with a guessed/leaked citationId.
  const r = await sb(
    `blog_citations?id=eq.${encodeURIComponent(citationId)}&workspace_id=eq.${encodeURIComponent(ws.id)}&select=*`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: auth.userId || null,
        updated_at: new Date().toISOString(),
      }),
    },
  )
  if (!r.ok) {
    console.error(`[content-items/citations-decide] patch failed ${r.status}`)
    return res.status(500).json({ error: 'decide_failed' })
  }
  const rows = await r.json()
  if (!rows?.[0]) return res.status(404).json({ error: 'citation_not_found' })
  return res.status(200).json({ citation: rows[0] })
}
