// POST /api/content-items/citations-enrich  { id }
//
// Runs the research-citation enrichment pass (api/_lib/citations/pipeline.js)
// for one blog/series-part content_item and persists any accepted results as
// 'suggested' rows on blog_citations. This is BOTH:
//   - the "Find supporting research" on-demand action (Phase 5 — any existing
//     blog, including the ~14 already-remediated pieces from #2665), and
//   - reachable from Phase 4's automatic post-draft hookpoints, which call
//     the shared runCitationEnrichmentForContentItem() directly (no HTTP hop)
//     rather than this route.
//
// Real external retrieval (PubMed, Semantic Scholar, a web-search tool call)
// plus an LLM verification judge — genuinely slow (multiple claims × multiple
// candidates × a network fetch + a model call each). maxDuration matches
// split-into-series.js's budget for the same reason (a multi-pass AI pipeline
// on one request).
//
// Auth: Clerk JWT + workspace org-id check + EDITOR_ROLES (same gate as the
// approve/publish flow this feeds into — proposing citations is a content-
// moderation-adjacent action, not a read).
//
// Response 200: { ran, inserted, claimsConsidered, reason? }
// Errors: 400 (validation), 401/403 (auth), 404 (no workspace/draft), 500.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { runCitationEnrichmentForContentItem } from '../../_lib/citations/runForContentItem.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const id = req.body?.id ? String(req.body.id) : null
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  try {
    const result = await runCitationEnrichmentForContentItem({ workspaceId: ws.id, contentItemId: id })
    if (!result.ran && result.reason === 'draft_not_found') {
      return res.status(404).json({ error: 'draft_not_found' })
    }
    return res.status(200).json(result)
  } catch (e) {
    console.error('[content-items/citations-enrich] failed:', e?.message)
    return res.status(500).json({ error: 'enrichment_failed' })
  }
}
