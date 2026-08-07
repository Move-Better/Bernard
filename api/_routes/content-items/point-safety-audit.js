// POST /api/content-items/point-safety-audit
//
// Phase 2b of "Make a point" (.claude/make-a-point-spec.md) — the advisory
// safety-flag chip's async check.
//
// Thin HTTP wrapper over auditPointContentSafety() in
// api/_lib/pointSafetyAudit.js, which judges whether the stored draft held
// the point-content framing (hedged mechanism, never asserted as fact; no
// reader-directed instruction) and persists point_safety_score +
// point_safety_audit.
//
// Designed to be called fire-and-forget after content_item creation, the
// same way voice-audit.js is — it never blocks the user: failures are
// recorded on point_safety_audit and returned as { audited: false }.
//
// Body: { contentItemId }
// Returns: { ok, contentItemId, score?, gate?, audited, reason? }

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { auditPointContentSafety } from '../../_lib/pointSafetyAudit.js'

const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'media', ws.id))) return

  const { contentItemId } = req.body || {}
  if (!contentItemId) return err(res, 'Missing contentItemId')
  if (!UUID_RE.test(contentItemId)) return err(res, 'Invalid contentItemId', 400)

  const result = await auditPointContentSafety(ws, contentItemId)
  const status = result.ok ? 200 : (result.reason === 'item_not_found' ? 404 : 200)
  return res.status(status).json({ contentItemId, ...result })
}
