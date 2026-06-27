// POST /api/content-items/suggest-split
//
// Multi-piece extract detection (PR 4 —
// .claude/design-interview-output-voice-fidelity.md, decision 3 + PR 4).
//
// Thin HTTP wrapper over detectInterviewThreads() in api/_lib/detectThreads.js.
// Read-only: it evaluates a blog content_item's source transcript and returns
// a recommendation { recommended_parts, rationale, titles }. It does NOT split
// anything — Story Detail uses the result to OPTIONALLY surface a "split into N
// posts?" banner. Accepting the proposal calls /api/content-items/split-into-
// series, which runs the actual cluster + write pipeline.
//
// Called on demand from Story Detail (cached client-side by React Query), not
// fire-and-forget, so a fresh load reflects the current piece state.
//
// Body: { id }   (content_item id)
// Returns: { id, eligible, recommended_parts, rationale?, titles?, reason? }

export const config = { runtime: 'nodejs', maxDuration: 30 }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { detectInterviewThreads } from '../../_lib/detectThreads.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const { id } = req.body || {}
  if (!id) return err(res, 'Missing id')
  if (!UUID_RE.test(id)) return err(res, 'invalid_id', 400)

  // Ownership pre-check — confirm item belongs to this workspace before
  // delegating to the lib. The lib also scopes by workspace_id, but a
  // handler-level check is the primary isolation gate.
  const ownerCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/content_items?id=eq.${id}&workspace_id=eq.${ws.id}&select=id&limit=1`,
    { signal: AbortSignal.timeout(8_000), headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  )
  if (!ownerCheck.ok) {
    console.error('[suggest-split] ownership check failed:', ownerCheck.status)
    return err(res, 'ownership_check_failed', 503)
  }
  const owned = await ownerCheck.json().catch(() => [])
  if (!owned.length) return err(res, 'item_not_found', 404)

  const result = await detectInterviewThreads(ws, id)
  const status = result.reason === 'item_not_found' ? 404 : 200
  return res.status(status).json({ id, ...result })
}
