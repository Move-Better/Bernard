// Citation-question actions — the write half of the /seo scoreboard.
//
//   queue_goal — "→ Monday's interview": stamps goal_queued_at on the tracked
//                question AND prepends it to workspaces.topic_suggestions
//                (category 'AI answer gap', priority high), which is the live
//                seam the interview surfaces already read (NewInterview chips
//                + getSuggestedTopics ranking). The loop is real wiring, not
//                a label.
//   dismiss    — deactivates a tracked question (stops future probes).
//   add        — tracks a manual question (source='manual').
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SUGGESTIONS = 40

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function queueGoal(ws, id, res) {
  if (!UUID_RE.test(id || '')) return res.status(400).json({ error: 'invalid_id' })

  const qRes = await sb(
    `seo_tracked_questions?id=eq.${id}&workspace_id=eq.${ws.id}&select=id,question,topic&limit=1`
  )
  if (!qRes.ok) return res.status(500).json({ error: 'question_fetch_failed' })
  const row = (await qRes.json().catch(() => []))?.[0]
  if (!row) return res.status(404).json({ error: 'question_not_found' })

  // Stamp the question first — the scoreboard's "Queued" state reads this.
  const stamp = await sb(`seo_tracked_questions?id=eq.${row.id}&workspace_id=eq.${ws.id}`, {
    method:  'PATCH',
    headers: { Prefer: 'return=minimal' },
    body:    JSON.stringify({ goal_queued_at: new Date().toISOString() }),
  })
  if (!stamp.ok) return res.status(500).json({ error: 'queue_failed' })

  // Then surface it where interviews start: workspaces.topic_suggestions.
  const wsRes = await sb(`workspaces?id=eq.${ws.id}&select=topic_suggestions&limit=1`)
  const current = wsRes.ok ? ((await wsRes.json().catch(() => []))?.[0]?.topic_suggestions || []) : []
  const list = Array.isArray(current) ? current : []
  const exists = list.some((s) => String(s?.topic || '').trim().toLowerCase() === row.question.trim().toLowerCase())
  if (!exists) {
    const next = [
      {
        topic:    row.question,
        category: 'AI answer gap',
        priority: 'high',
        keywords: [row.topic].filter(Boolean),
        pnwNote:  'AI assistants answer this without you today — a citation-scoreboard gap.',
      },
      ...list,
    ].slice(0, MAX_SUGGESTIONS)
    const patch = await sb(`workspaces?id=eq.${ws.id}`, {
      method:  'PATCH',
      headers: { Prefer: 'return=minimal' },
      body:    JSON.stringify({ topic_suggestions: next }),
    })
    if (!patch.ok) {
      // The stamp already landed; surface the partial failure honestly.
      console.error('[seo/citation-question] topic_suggestions patch failed:', patch.status)
      return res.status(500).json({ error: 'suggestion_write_failed' })
    }
  }
  return res.status(200).json({ ok: true, queued: true })
}

async function dismissQuestion(ws, id, res) {
  if (!UUID_RE.test(id || '')) return res.status(400).json({ error: 'invalid_id' })
  const r = await sb(`seo_tracked_questions?id=eq.${id}&workspace_id=eq.${ws.id}`, {
    method:  'PATCH',
    headers: { Prefer: 'return=minimal' },
    body:    JSON.stringify({ active: false }),
  })
  if (!r.ok) return res.status(500).json({ error: 'dismiss_failed' })
  return res.status(200).json({ ok: true })
}

async function addQuestion(ws, body, res) {
  const question = String(body?.question || '').trim()
  if (!question || question.length > 160) return res.status(400).json({ error: 'invalid_question' })
  const topic = String(body?.topic || '').trim().slice(0, 60) || null

  // Case-insensitive dedup (DB UNIQUE is exact-text only): an existing match
  // is returned as-is — reactivated if it had been dismissed.
  const existRes = await sb(
    `seo_tracked_questions?workspace_id=eq.${ws.id}&select=id,question,active&limit=500`
  )
  const existing = (existRes.ok ? await existRes.json().catch(() => []) : [])
    .find((r) => String(r.question || '').trim().toLowerCase() === question.toLowerCase())
  if (existing) {
    if (!existing.active) {
      const up = await sb(`seo_tracked_questions?id=eq.${existing.id}&workspace_id=eq.${ws.id}`, {
        method:  'PATCH',
        headers: { Prefer: 'return=minimal' },
        body:    JSON.stringify({ active: true }),
      })
      if (!up.ok) return res.status(500).json({ error: 'add_failed' })
    }
    return res.status(200).json({ ok: true, question: existing })
  }

  const r = await sb('seo_tracked_questions?on_conflict=workspace_id,question', {
    method:  'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{
      workspace_id: ws.id,
      question,
      topic,
      source: 'manual',
      active: true,
    }]),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    console.error('[seo/citation-question] add failed:', r.status, text.slice(0, 200))
    return res.status(500).json({ error: 'add_failed' })
  }
  const rows = await r.json().catch(() => [])
  return res.status(200).json({ ok: true, question: rows?.[0] || null })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'seo-citations', ws.id))) return

  const { action, id } = req.body || {}
  if (action === 'queue_goal') return queueGoal(ws, id, res)
  if (action === 'dismiss')    return dismissQuestion(ws, id, res)
  if (action === 'add')        return addQuestion(ws, req.body, res)
  return res.status(400).json({ error: 'unknown_action' })
}
