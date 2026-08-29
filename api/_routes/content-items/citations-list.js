// GET /api/content-items/citations-list?id=<contentItemId>
//
// Lists all research-citation rows (any status) for one content_item, for the
// review panel in the publish editor. Read side of the human gate described
// in .claude/blog-research-citations-spec.md — the panel shows 'suggested'
// rows for decision and 'approved'/'rejected' ones for context (a reviewer
// can see what they already ruled on).
//
// Each row also carries a computed `willInlineLink` (boolean) — the SAME
// exact-match rule insertCitations.js enforces at publish time
// (quoteMatch.js), checked live against the content_item's CURRENT `content`
// on every read. Per the spec's "Link placement — LOCKED 2026-08-28": the
// reviewer must see whether approving a citation right now would produce an
// inline link or fall back to footer-only, computed fresh — never a stale
// flag captured at enrichment time, since the body may have been hand-edited
// since.
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
import { willInlineLink } from '../../_lib/citations/quoteMatch.js'

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
  const rows = await r.json()
  if (rows.length === 0) return res.status(200).json({ citations: [] })

  // Read the CURRENT body once, fresh, so every row's willInlineLink reflects
  // this exact moment — not a flag from whenever enrichment ran. Fails open
  // to an empty body on a read hiccup: every quote then correctly reads as
  // "not found" (count 0), which is the safe footer-only degrade, not a crash.
  const itemRes = await sb(
    `content_items?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(ws.id)}&select=content&limit=1`,
  )
  let currentBody = ''
  if (itemRes.ok) {
    const itemRows = await itemRes.json()
    currentBody = String(itemRows?.[0]?.content || '')
  } else {
    console.error(`[content-items/citations-list] content fetch failed ${itemRes.status}`)
  }

  const citations = rows.map((c) => ({
    ...c,
    willInlineLink: willInlineLink(currentBody, c.claim_quote),
  }))
  return res.status(200).json({ citations })
}
