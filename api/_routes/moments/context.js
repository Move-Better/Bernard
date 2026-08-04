// GET /api/moments/context?id=<moment uuid> — the surrounding interview turns
// a banked quote was pulled from, for the /moments review queue. A reviewer
// deciding Approve/Retire/Send-back can see the question that prompted the
// quote and the couple of turns around it inline, without leaving the queue.
//
// Reuses momentWindow() (momentPlan.js) — the exact primitive that sources a
// draft — so the "context" a reviewer reads is the same contiguous slice the
// generator would draw from. Returns:
//   topic        the source interview's topic (panel header)
//   excerpt      the moment's excerpt (so the client can mark the quoted span)
//   turns        [{ role, content }] — role 'assistant' = interviewer, 'user'
//                = clinician; contiguous, budgeted to MOMENT_WINDOW_MAX_CHARS
//   anchorIndex  index into `turns` of the turn the quote came from (≥ 0), or
//                -1 with turns:[] when the anchor can't be resolved (time-coded
//                anchor, out-of-range msg_idx) — the client shows an
//                "open the full story" fallback rather than an empty panel.
//
// Read-only; interviews.messages is never mutated here. Any workspace role may
// read (same as the moment list it sits beside).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { momentWindow, MOMENT_WINDOW_MAX_CHARS } from '../../_lib/momentPlan.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const id = new URL(req.url, 'http://localhost').searchParams.get('id')
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'invalid_id' })

  try {
    // Fetch the moment (workspace-scoped) — its anchor + interview + excerpt.
    const mRes = await sb(
      `moments?id=eq.${id}&workspace_id=eq.${ws.id}&select=id,excerpt,anchor,interview_id&limit=1`,
    )
    if (!mRes.ok) {
      console.error('[moments/context] moment fetch failed:', mRes.status)
      return res.status(500).json({ error: 'context_unavailable' })
    }
    const [moment] = await mRes.json()
    if (!moment) return res.status(404).json({ error: 'not_found' })

    // The transcript the window is cut from. Same workspace by construction;
    // the workspace filter is defense-in-depth against a cross-tenant id.
    const iRes = await sb(
      `interviews?id=eq.${moment.interview_id}&workspace_id=eq.${ws.id}&select=topic,messages&limit=1`,
    )
    if (!iRes.ok) {
      console.error('[moments/context] interview fetch failed:', iRes.status)
      return res.status(500).json({ error: 'context_unavailable' })
    }
    const [interview] = await iRes.json()

    const win = interview
      ? momentWindow(interview.messages, moment.anchor, { maxChars: MOMENT_WINDOW_MAX_CHARS })
      : null

    // Fail closed with a resolvable shape, not an error: a time-coded anchor or
    // a deleted interview means "no inline context", and the client renders an
    // "open the full story" fallback. The queue keeps working either way.
    if (!win) {
      return res.status(200).json({
        topic: interview?.topic || null,
        excerpt: moment.excerpt || null,
        turns: [],
        anchorIndex: -1,
      })
    }

    return res.status(200).json({
      topic: interview.topic || null,
      excerpt: moment.excerpt || null,
      turns: win.messages,
      anchorIndex: win.anchorIndex,
    })
  } catch (e) {
    console.error('[moments/context] threw:', e?.message)
    return res.status(500).json({ error: 'context_unavailable' })
  }
}
