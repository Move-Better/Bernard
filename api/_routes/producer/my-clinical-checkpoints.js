// GET /api/producer/my-clinical-checkpoints
//
// The two clinical-judgment checkpoints Home's attention strip did NOT
// already cover before ProducerHome (2026-07-29 — see .claude/decisions.md
// and the checkpoint audit that motivated it): words approval (the hardest
// gate in the pipeline — it blocks ALL publishing for a story, and had zero
// aggregate surface anywhere) and practice-memory supersessions (a confirm
// there can retract a live published answer, buried in settings only).
//
// Blog-review and answer-review nudges are deliberately NOT duplicated here —
// Home.jsx already fetches those itself (/api/content-plan/week-summary and
// /api/answers). This route exists only to fill the two gaps those don't
// cover, scoped to the CALLING clinician's own staff row.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function countRows(path) {
  const r = await sb(`${path}${path.includes('?') ? '&' : '?'}select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  })
  if (!r.ok) { console.error('[producer/my-clinical-checkpoints] count failed:', path, r.status); return 0 }
  const cr = r.headers.get('content-range') || ''
  return Number(cr.split('/')[1]) || 0
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const clerkUserId = auth.userId || auth.user?.id || null
  if (!clerkUserId) return res.status(200).json({ wordsApprovals: 0, supersessions: 0 })

  const staffRes = await sb(`staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id&limit=1`)
  const staffRows = staffRes.ok ? await staffRes.json().catch(() => []) : []
  const staffId = staffRows[0]?.id || null
  if (!staffId) return res.status(200).json({ wordsApprovals: 0, supersessions: 0 })

  try {
    const [wordsApprovals, supersessions] = await Promise.all([
      countRows(`interviews?workspace_id=eq.${ws.id}&staff_id=eq.${staffId}&status=eq.completed&summary_text=not.is.null&words_approved_at=is.null`),
      countRows(`practice_memory_supersessions?workspace_id=eq.${ws.id}&staff_id=eq.${staffId}&status=eq.pending`),
    ])
    return res.status(200).json({ wordsApprovals, supersessions })
  } catch (e) {
    console.error('[producer/my-clinical-checkpoints] failed:', e?.message)
    return res.status(500).json({ error: 'fetch_failed' })
  }
}
