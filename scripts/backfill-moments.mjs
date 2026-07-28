#!/usr/bin/env node
/**
 * Backfill the moment bank (P2, .claude/moment-bank-sprint.md) from historical
 * completed interviews.
 *
 * Imports the REAL live extraction path (api/_lib/momentExtract.js) — the same
 * extract → verbatim-anchor → score → embed → dedup/cluster → insert pipeline
 * the interview-completion hook runs, so the backfill can never drift from
 * what a fresh completion produces. Idempotent: an interview that already has
 * moments rows is skipped (both here and inside the lib).
 *
 * Processes interviews OLDEST-FIRST so dedup clustering builds up the way it
 * would have live (a later near-duplicate joins the earlier moment's cluster).
 *
 * COST NOTE (per the CLAUDE.md dry-run rule): extraction itself is the
 * expensive part (2 LLM calls + embeddings per interview). --dry-run therefore
 * does NOT run extraction at all — it only lists which interviews would be
 * processed. To validate output quality cheaply, use --limit=2 for a real run
 * on two interviews and inspect the rows.
 *
 * Usage:
 *   node scripts/backfill-moments.mjs --dry-run
 *   node scripts/backfill-moments.mjs --workspace=movebetter --limit=2
 *   node scripts/backfill-moments.mjs --workspace=movebetter
 *   node scripts/backfill-moments.mjs                       (all workspaces)
 *   node scripts/backfill-moments.mjs --ids=<uuid>,<uuid>   (specific interviews)
 *
 * Requires in env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY
 * (embeddings), AI_GATEWAY_API_KEY (extraction + scoring models).
 */

import { extractAndBankMoments, MOMENT_BANK_MIN_SCORE, MOMENT_DEDUP_SIM } from '../api/_lib/momentExtract.js'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const limitArg = args.find((a) => a.startsWith('--limit='))
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null
const wsArg = args.find((a) => a.startsWith('--workspace='))
const WS_SLUG = wsArg ? wsArg.split('=')[1] : null
const idsArg = args.find((a) => a.startsWith('--ids='))
const ONLY_IDS = idsArg ? idsArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
for (const [name, v] of [
  ['SUPABASE_URL', SUPABASE_URL],
  ['SUPABASE_SERVICE_KEY', SUPABASE_KEY],
  ...(DRY_RUN ? [] : [
    ['OPENAI_API_KEY', process.env.OPENAI_API_KEY],
    ['AI_GATEWAY_API_KEY', process.env.AI_GATEWAY_API_KEY],
  ]),
]) {
  if (!v) {
    console.error(`Missing env: ${name}`)
    process.exit(1)
  }
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function sbJson(path) {
  const r = await sb(path)
  if (!r.ok) throw new Error(`${path.split('?')[0]} → ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  return r.json()
}

// Paged fetch — PostgREST caps a single response; walk in pages of 500.
async function sbAll(basePath) {
  const out = []
  for (let offset = 0; ; offset += 500) {
    const page = await sbJson(`${basePath}&limit=500&offset=${offset}`)
    out.push(...page)
    if (page.length < 500) return out
  }
}

function histogram(scores) {
  const buckets = new Array(10).fill(0)
  for (const s of scores) buckets[Math.min(9, Math.max(0, Math.floor(s / 10)))]++
  return buckets.map((n, i) => `${i * 10}-${i * 10 + 9}: ${'#'.repeat(n)}${n ? ` (${n})` : ''}`).join('\n')
}

async function main() {
  console.log(`moment-bank backfill — bar=${MOMENT_BANK_MIN_SCORE}, dedup sim=${MOMENT_DEDUP_SIM}${DRY_RUN ? ' [DRY RUN]' : ''}`)

  const workspaces = await sbAll('workspaces?select=id,slug,display_name,clinic_context&order=created_at.asc')
  const bySlug = WS_SLUG ? workspaces.filter((w) => w.slug === WS_SLUG) : workspaces
  if (WS_SLUG && !bySlug.length) {
    console.error(`No workspace with slug '${WS_SLUG}'`)
    process.exit(1)
  }

  // Interviews already banked → skip without loading transcripts.
  const already = new Set((await sbAll('moments?select=interview_id')).map((r) => r.interview_id))

  let processed = 0
  const allScores = []
  const perInterview = []
  let totalBanked = 0
  let totalBelowBar = 0
  let totalUnlocatable = 0
  let totalClustersJoined = 0

  for (const ws of bySlug) {
    // Oldest first so clusters accrete in capture order.
    const interviews = await sbAll(
      `interviews?workspace_id=eq.${ws.id}&status=eq.completed` +
      `&select=id,staff_id,topic,region,created_at&order=created_at.asc`,
    )
    const todo = interviews.filter((iv) => !already.has(iv.id) && (!ONLY_IDS || ONLY_IDS.includes(iv.id)))
    console.log(`\n== ${ws.slug}: ${interviews.length} completed interviews, ${todo.length} without moments`)

    for (const iv of todo) {
      if (LIMIT != null && processed >= LIMIT) break
      if (DRY_RUN) {
        console.log(`  would process ${iv.id} (${iv.created_at?.slice(0, 10)}, topic: ${iv.topic || '—'})`)
        processed++
        continue
      }
      // Load the transcript only when actually processing (messages are big).
      const [full] = await sbJson(`interviews?id=eq.${iv.id}&select=messages`)
      const summary = await extractAndBankMoments({
        workspace: ws,
        interview: { ...iv, messages: full?.messages },
      })
      processed++
      const line = summary.error
        ? `ERROR: ${summary.error}`
        : summary.skipped
          ? `skipped (${summary.skipped})`
          : `proposed ${summary.proposed}, located ${summary.located} (dropped ${summary.dropped_unlocatable} unlocatable), banked ${summary.banked}, below bar ${summary.belowBar}, joined ${summary.clustersJoined} existing clusters`
      console.log(`  ${iv.id} (${iv.created_at?.slice(0, 10)}) — ${line}`)
      perInterview.push({ ws: ws.slug, id: iv.id, ...summary })
      allScores.push(...(summary.scored || []))
      totalBanked += summary.banked || 0
      totalBelowBar += summary.belowBar || 0
      totalUnlocatable += summary.dropped_unlocatable || 0
      totalClustersJoined += summary.clustersJoined || 0
    }
    if (LIMIT != null && processed >= LIMIT) break
  }

  console.log(`\n=== done: ${processed} interviews${DRY_RUN ? ' (dry run, nothing extracted)' : ''}`)
  if (!DRY_RUN && allScores.length) {
    console.log(`banked ${totalBanked}, below bar ${totalBelowBar}, unlocatable ${totalUnlocatable}, joined ${totalClustersJoined} clusters`)
    console.log(`\nscore distribution across ${allScores.length} located moments (bar=${MOMENT_BANK_MIN_SCORE}):`)
    console.log(histogram(allScores))
    const errored = perInterview.filter((p) => p.error)
    if (errored.length) {
      console.log(`\n${errored.length} interviews errored:`)
      for (const p of errored) console.log(`  ${p.ws} ${p.id}: ${p.error}`)
    }
  }
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
