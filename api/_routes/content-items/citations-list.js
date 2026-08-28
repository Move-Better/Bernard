// GET /api/content-items/citations-list?id=<contentItemId>
//
// Lists all research-citation rows (any status) for one content_item, for the
// review panel in the publish editor. Read side of the human gate described
// in .claude/blog-research-citations-spec.md — the panel shows 'suggested'
// rows for decision and 'approved'/'rejected' ones for context (a reviewer
// can see what they already ruled on).
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES (same gate as the
// enrich/decide routes — citations are part of the same content-moderation
// surface as approve/publish, not a general read).
//
// Response 200: { citations: [...] }
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace), 500.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT = 'id,content_item_id,claim_text,claim_quote,source,source_url,source_title,source_type,why_match,confidence,status,decided_at,decided_by,created_at'

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  const url = new URL(req.url, 'http://localhost')
  const id = url.searchParams.get('id')
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const r = await sb(
    `blog_citations?content_item_id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(ws.id)}` +
    `&select=${SELECT}&order=confidence.desc`,
  )
  if (!r.ok) {
    console.error(`[content-items/citations-list] fetch failed ${r.status}`)
    return res.status(500).json({ error: 'fetch_failed' })
  }
  const citations = await r.json()
  return res.status(200).json({ citations })
}
