// PATCH /api/feedback/resolve
//
// Marks a feedback row as fixed and best-effort emails the original reporter
// (if they have an email on file) so they know it's safe to rely on the
// feature they reported as broken again — the whole point being staff who
// stop using Bernard at a bottleneck shouldn't have to guess when to come back.
//
// Workspace-scoped: a staffer can only resolve their own workspace's feedback.
// The shared logic (email + patch) lives in _lib/resolveFeedback.js so the
// headless system trigger (POST /api/cron/resolve-feedback) can never drift
// from what this endpoint sends.
//
// Body (JSON):
//   id     string  required — feedback row id (uuid)
//   note   string  required — what was fixed, in plain language, shown verbatim
//                             to the reporter in the email and the Home banner.
//                             Write it for the person who filed it: what was
//                             wrong, what changed, whether it's safe to go back.

import { requireRole }         from '../../_lib/auth.js'
import { workspaceContext }    from '../../_lib/workspaceContext.js'
import { resolveFeedbackRow }  from '../../_lib/resolveFeedback.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const wsCtx = await workspaceContext(req).catch(() => null)
  if (!wsCtx) return res.status(400).json({ error: 'workspace_not_resolved' })

  const auth = await requireRole(req, null, { orgId: wsCtx.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  const { id, note } = req.body ?? {}
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  const r = await resolveFeedbackRow({ id, note, workspaceId: wsCtx.id })
  if (r.status === 'note_required') return res.status(400).json({ error: 'note_required' })
  if (r.status === 'not_found')     return res.status(404).json({ error: 'not_found' })
  if (r.status === 'lookup_failed') return res.status(500).json({ error: 'lookup_failed' })
  if (r.status === 'update_failed') return res.status(500).json({ error: 'update_failed' })

  return res.status(200).json({ ok: true, id: r.id, notified: !!r.notified })
}

export const config = { runtime: 'nodejs' }
