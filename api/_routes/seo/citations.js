// Citation scoreboard read — the "Are you the answer?" section on /seo.
//
// Reads the tracked-question set + the latest probe per (question, engine)
// and computes citation share (questions where ANY engine cites the clinic /
// questions probed), per-engine tallies, and the trend vs the previous probe
// round. Probing itself happens in the weekly cron (probe-citations.js);
// this is a pure read.
//
// Node runtime + Express-style (req, res).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole }      from '../../_lib/auth.js'
import { enforceLimit }     from '../../_lib/ratelimit.js'
import { availableEngines } from '../../_lib/citationProbe.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const ENGINES = ['chatgpt', 'perplexity', 'google']

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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'seo-citations', ws.id))) return

  const live = availableEngines()
  const connectedEngines = Object.fromEntries(ENGINES.map((e) => [e, live.includes(e)]))

  const [qRes, pRes] = await Promise.all([
    sb(`seo_tracked_questions?workspace_id=eq.${ws.id}&active=is.true` +
       `&select=id,question,topic,goal_queued_at&order=created_at.asc&limit=20`),
    sb(`seo_citation_probes?workspace_id=eq.${ws.id}` +
       `&select=question_id,engine,cited,top_cited_domain,probed_at&order=probed_at.desc&limit=800`),
  ])
  if (!qRes.ok || !pRes.ok) {
    console.error('[seo/citations] fetch failed:', qRes.status, pRes.status)
    return res.status(500).json({ error: 'citation_fetch_failed' })
  }
  const questions = await qRes.json().catch(() => [])
  const probes    = await pRes.json().catch(() => [])
  const questionIds = new Set(questions.map((q) => q.id))

  if (questions.length === 0 || probes.length === 0) {
    return res.status(200).json({
      available: false,
      seededQuestions: questions.length,
      connectedEngines,
    })
  }

  // Latest + previous probe per (question, engine) — rows arrive newest-first.
  // Rounds are deliberately NOT bucketed by probe date: a deadline-split or
  // re-run cron lands one logical round across multiple dates, which would
  // corrupt the share denominator. Instead the hero share derives from the
  // exact same latest-per-(question, engine) state the table renders — the
  // top-line % and the rows can never disagree — and the trend compares each
  // question against its own previous probe.
  const latest   = new Map()
  const previous = new Map()
  for (const p of probes) {
    if (!questionIds.has(p.question_id)) continue
    const key = `${p.question_id}:${p.engine}`
    if (!latest.has(key)) latest.set(key, p)
    else if (!previous.has(key)) previous.set(key, p)
  }

  const share = { probed: 0, cited: 0 }
  const prev  = { probed: 0, cited: 0 }
  for (const q of questions) {
    let hasCur = false, curCited = false, hasPrev = false, prevCited = false
    for (const engine of ENGINES) {
      const l = latest.get(`${q.id}:${engine}`)
      if (l) { hasCur = true; curCited = curCited || l.cited === true }
      const pv = previous.get(`${q.id}:${engine}`)
      if (pv) { hasPrev = true; prevCited = prevCited || pv.cited === true }
    }
    if (hasCur)  { share.probed++; if (curCited) share.cited++ }
    if (hasPrev) { prev.probed++;  if (prevCited) prev.cited++ }
  }

  const perEngine = {}
  for (const engine of ENGINES) {
    if (!connectedEngines[engine]) { perEngine[engine] = null; continue }
    const rows = [...latest.values()].filter((p) => p.engine === engine)
    perEngine[engine] = { probed: rows.length, cited: rows.filter((p) => p.cited).length }
  }

  const rows = questions.map((q) => ({
    id:           q.id,
    question:     q.question,
    topic:        q.topic,
    goalQueuedAt: q.goal_queued_at,
    engines: Object.fromEntries(ENGINES.map((engine) => {
      const p = latest.get(`${q.id}:${engine}`)
      return [engine, p ? { cited: p.cited, topCitedDomain: p.top_cited_domain, probedAt: p.probed_at } : null]
    })),
  }))

  return res.status(200).json({
    available: true,
    connectedEngines,
    share: {
      citedQuestions:  share.cited,
      probedQuestions: share.probed,
      pct: share.probed > 0 ? Math.round((share.cited / share.probed) * 100) : 0,
      deltaQuestions: prev.probed > 0 ? share.cited - prev.cited : null,
    },
    perEngine,
    rows,
    lastProbedAt: probes[0]?.probed_at || null,
  })
}
