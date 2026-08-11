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

// Return the ROWS, not just how many there are.
//
// This route used to answer with two bare integers, which is why Home could
// only ever render "N to approve your words" pointing at an unfiltered
// /stories. Home's attention queue names every item and deep-links it
// (2026-08-11), so each checkpoint has to arrive with enough identity to
// render itself: an id to link to and a title to show.
//
// Capped at 25 per category — the queue is a to-do list, not a report, and a
// clinician with more than 25 pending words-approvals has a different problem
// than a longer list would solve.
const MAX_ITEMS = 25

async function fetchRows(path, select) {
  const r = await sb(`${path}&select=${select}&limit=${MAX_ITEMS}`)
  if (!r.ok) {
    console.error('[producer/my-clinical-checkpoints] fetch failed:', path, r.status)
    return []
  }
  return (await r.json().catch(() => [])) || []
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const empty = { wordsApprovals: 0, supersessions: 0, wordsApprovalItems: [], supersessionItems: [] }

  const clerkUserId = auth.userId || auth.user?.id || null
  if (!clerkUserId) return res.status(200).json(empty)

  const staffRes = await sb(`staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id&limit=1`)
  const staffRows = staffRes.ok ? await staffRes.json().catch(() => []) : []
  const staffId = staffRows[0]?.id || null
  if (!staffId) return res.status(200).json(empty)

  try {
    const [wordsRows, supersessionRows] = await Promise.all([
      fetchRows(
        `interviews?workspace_id=eq.${ws.id}&staff_id=eq.${staffId}&status=eq.completed&summary_text=not.is.null&words_approved_at=is.null&order=created_at.asc`,
        'id,topic,created_at',
      ),
      fetchRows(
        `practice_memory_supersessions?workspace_id=eq.${ws.id}&staff_id=eq.${staffId}&status=eq.pending&order=detected_at.asc`,
        'id,new_excerpt,new_source_label,detected_at',
      ),
    ])

    const wordsApprovalItems = wordsRows.map((r) => ({
      id: r.id,
      topic: r.topic || '',
      created_at: r.created_at,
    }))

    // `new_excerpt` is the changed teaching itself, which is what the person
    // actually has to recognize; the source label is a weaker fallback.
    const supersessionItems = supersessionRows.map((r) => ({
      id: r.id,
      summary: (r.new_excerpt || r.new_source_label || '').trim(),
      created_at: r.detected_at,
    }))

    return res.status(200).json({
      // Counts kept alongside the items so an older cached client keeps working.
      wordsApprovals: wordsApprovalItems.length,
      supersessions: supersessionItems.length,
      wordsApprovalItems,
      supersessionItems,
    })
  } catch (e) {
    console.error('[producer/my-clinical-checkpoints] failed:', e?.message)
    return res.status(500).json({ error: 'fetch_failed' })
  }
}
