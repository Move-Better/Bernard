import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// GET /api/cron/probe-citations
//
// Weekly "Are you the answer?" probe (Mondays 06:00 UTC — after gsc-snapshot
// at 04:00 so a first-ever run can seed questions from fresh GSC data).
//
// Per active workspace that has a domain to match against (website_hostname
// or gsc_site_url):
//   1. Load its active tracked questions (seo_tracked_questions).
//   2. If none exist, seed them: real GSC queries + published topics → Haiku
//      rewrites the demand as ≤12 natural patient questions (source='auto').
//      No GSC data and no published topics → skip; we never invent demand.
//   3. Probe each question on every available engine (ChatGPT web search,
//      Perplexity via gateway) and record cited / cited_urls / top domain.
//
// Readers take the newest probe row per (question, engine), so re-runs append
// harmlessly (same idempotency stance as gsc-snapshot). A global deadline
// guard stops before the 300s function wall — the weekly cadence picks up
// whatever a partial run left; probes are per-question rows, not batches.
//
// Auth: Bearer CRON_SECRET (same as gsc-snapshot.js / weekly-plan.js).

import { verifyCronSecret } from '../../_lib/auth.js'
import {
  availableEngines, clinicDomains, generateTrackedQuestions,
  probeEngine, summarizeCitations,
} from '../../_lib/citationProbe.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const MAX_QUESTIONS_PER_WS = 20
const PROBE_CONCURRENCY    = 4
const DEADLINE_MS          = 240_000 // leave headroom under the 300s wall

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; every query below is scoped by workspace_id from the workspace list
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

async function loadQuestions(wsId) {
  const r = await sb(
    `seo_tracked_questions?workspace_id=eq.${wsId}&active=is.true` +
    `&select=id,question,topic&order=created_at.asc&limit=${MAX_QUESTIONS_PER_WS}`
  )
  if (!r.ok) return null
  return r.json().catch(() => null)
}

// Seed the tracked-question set from real demand. Returns inserted rows
// (with ids) or [] when there was nothing to ground on.
async function seedQuestions(ws) {
  const [snapRows, topicRows] = await Promise.all([
    sb(`gsc_query_snapshots?workspace_id=eq.${ws.id}&select=query,impressions,captured_at` +
       `&order=captured_at.desc&limit=200`).then((r) => (r.ok ? r.json().catch(() => []) : [])),
    sb(`content_items?workspace_id=eq.${ws.id}&status=eq.published&topic=not.is.null&select=topic&limit=100`)
      .then((r) => (r.ok ? r.json().catch(() => []) : [])),
  ])

  // Latest snapshot only, ranked by impressions — the demand actually seen.
  const latestDate = String(snapRows?.[0]?.captured_at || '').slice(0, 10)
  const gscQueries = (snapRows || [])
    .filter((r) => String(r.captured_at || '').slice(0, 10) === latestDate)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .map((r) => r.query)
    .filter(Boolean)
  const topics = [...new Set((topicRows || []).map((r) => r.topic).filter(Boolean))]

  const generated = await generateTrackedQuestions({ ws, gscQueries, topics })
  if (generated.length === 0) return []

  // Case-insensitive dedup against EVERY existing row (incl. inactive/dismissed —
  // a dismissed question must not resurrect under different casing). The DB
  // UNIQUE is exact-text only, so this is the real guard.
  const existRes = await sb(
    `seo_tracked_questions?workspace_id=eq.${ws.id}&select=question&limit=500`
  )
  const existing = new Set(
    (existRes.ok ? await existRes.json().catch(() => []) : [])
      .map((r) => String(r.question || '').trim().toLowerCase())
  )
  const fresh = generated.filter((q) => !existing.has(q.question.trim().toLowerCase()))
  if (fresh.length === 0) return []

  const ins = await sb('seo_tracked_questions?on_conflict=workspace_id,question', {
    method:  'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(fresh.map((q) => ({
      workspace_id: ws.id,
      question:     q.question.trim(),
      topic:        q.topic || null,
      source:       'auto',
    }))),
  })
  if (!ins.ok) {
    const text = await ins.text().catch(() => '')
    console.error('[cron/probe-citations] seed insert failed', ws.slug, ins.status, text.slice(0, 200))
    return []
  }
  return ins.json().catch(() => [])
}

async function probeWorkspace(ws, engines, deadline, summary) {
  const domains = clinicDomains(ws)
  if (domains.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-domain' })
    return
  }

  let questions = await loadQuestions(ws.id)
  if (questions === null) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'questions_fetch_failed' })
    return
  }
  let seeded = 0
  if (questions.length === 0) {
    try {
      questions = (await seedQuestions(ws)).slice(0, MAX_QUESTIONS_PER_WS)
      seeded = questions.length
    } catch (e) {
      console.error('[cron/probe-citations] seed failed', ws.slug, e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'seed_failed' })
      return
    }
    if (questions.length === 0) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'nothing-to-ground-on' })
      return
    }
  }

  // One probe job per (question, engine); run with bounded concurrency.
  const jobs = []
  for (const q of questions) for (const engine of engines) jobs.push({ q, engine })

  const rows = []
  let failed = 0
  let cursor = 0
  async function worker() {
    while (cursor < jobs.length) {
      if (Date.now() > deadline) return
      const { q, engine } = jobs[cursor++]
      try {
        const { urls, excerpt } = await probeEngine(engine, q.question, ws.location)
        const { cited, topCitedDomain } = summarizeCitations(urls, domains)
        rows.push({
          workspace_id:     ws.id,
          question_id:      q.id,
          engine,
          cited,
          cited_urls:       urls.slice(0, 20),
          top_cited_domain: topCitedDomain,
          answer_excerpt:   excerpt,
        })
      } catch (e) {
        failed++
        console.error('[cron/probe-citations]', ws.slug, engine, e?.message)
      }
    }
  }
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker))

  if (rows.length > 0) {
    const ins = await sb('seo_citation_probes', {
      method:  'POST',
      headers: { Prefer: 'return=minimal' },
      body:    JSON.stringify(rows),
    })
    if (!ins.ok) {
      const text = await ins.text().catch(() => '')
      console.error('[cron/probe-citations] probe insert failed', ws.slug, ins.status, text.slice(0, 200))
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `insert_${ins.status}` })
      return
    }
  }
  summary.workspaces.push({
    id: ws.id, slug: ws.slug, seeded,
    probed: rows.length, cited: rows.filter((r) => r.cited).length, failed,
    partial: Date.now() > deadline || undefined,
  })
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase env not configured' })

  const engines = availableEngines()
  if (engines.length === 0) return res.status(200).json({ skipped: 'no-engine-credentials' })

  const wsRes = await sb(
    'workspaces?status=eq.active&or=(website_hostname.not.is.null,gsc_site_url.not.is.null)' +
    '&select=id,slug,location,display_name,website_hostname,gsc_site_url'
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json().catch(() => [])

  const deadline = Date.now() + DEADLINE_MS
  const summary = { startedAt: new Date().toISOString(), engines, workspaces: [] }
  for (const ws of workspaces) {
    if (Date.now() > deadline) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'deadline' })
      continue
    }
    try {
      await probeWorkspace(ws, engines, deadline, summary)
    } catch (e) {
      console.error('[cron/probe-citations] workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'workspace_error' })
    }
  }
  summary.finishedAt = new Date().toISOString()
  return res.status(200).json(summary)
}

export default withSentry(handler)
