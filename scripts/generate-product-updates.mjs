#!/usr/bin/env node
// Generate role-tagged, plain-language product_updates entries from recently
// merged PRs (P3 of ProducerHome — .claude/decisions.md 2026-07-29).
//
// Replaces the hand-maintained public/release-notes.json for role-targeted
// announcements, which had gone stale for two months because hand maintenance
// loses to this repo's merge rate. This script is meant to run nightly as a
// scheduled Claude task (same pattern as bernard-weekly-staff-summary and
// triage-bernard-feedback in .claude/scheduled-tasks/) rather than a Vercel
// cron, because it shells out to `gh` and calls an LLM to WRITE prose — both
// are a better fit for a scheduled agent invocation than a serverless function.
//
// What it does:
//   1. Finds the newest product_updates row's created_at (or 24h ago if none).
//   2. `gh pr list --state merged --search 'merged:>=<that date>'` for new PRs.
//   3. Filters out PRs that are pure infra/refactor/test/docs (title prefixes
//      chore/test/docs/ci/refactor) — those aren't user-visible changes.
//   4. Asks the model to write ONE plain-language sentence per PR (or skip it
//      if it has no user-visible effect), tagged with which roles care
//      (producer/clinician/owner; [] = everyone), and a page_hint.
//   5. Inserts the results into product_updates.
//
// Usage: node scripts/generate-product-updates.mjs [--dry-run]

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DRY_RUN = process.argv.includes('--dry-run')

const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY
const REPO = 'Move-Better/Bernard'

const SKIP_PREFIX_RE = /^(chore|test|docs|ci|refactor)(\(|:)/i

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

async function lastGeneratedAt() {
  const r = await sb('product_updates?select=created_at&order=created_at.desc&limit=1')
  if (!r.ok) throw new Error(`product_updates lookup failed: ${r.status}`)
  const rows = await r.json()
  return rows[0]?.created_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
}

function mergedPrsSince(isoDate) {
  const day = isoDate.slice(0, 10)
  const out = execFileSync('gh', [
    'pr', 'list', '--repo', REPO, '--state', 'merged',
    '--search', `merged:>=${day}`,
    '--json', 'number,title,body,mergedAt',
    '--limit', '100',
  ], { encoding: 'utf8' })
  return JSON.parse(out).filter((pr) => Date.parse(pr.mergedAt) > Date.parse(isoDate))
}

async function draftEntry(pr) {
  const prompt = `You write one-sentence "what's new" entries for a chiropractic-clinic content platform called Bernard. Given a merged PR's title and description, decide:
- Does this change anything a PRODUCER (operational editor: approves posts, reviews clips, monitors channels) or CLINICIAN (records interviews, writes/approves patient-facing content) would notice using the app? If it's pure infra/internal/no user-visible effect, respond with exactly: SKIP
- If it's user-visible, write ONE plain-language sentence (no jargon, no PR numbers, active voice, what changed from the user's side of the screen) and which roles care: producer, clinician, both, or owner-only (billing/settings).

PR title: ${pr.title}
PR body: ${(pr.body || '').slice(0, 1500)}

Respond as JSON: {"skip": boolean, "summary": string, "roles": string[]} — roles is a subset of ["producer","clinician","owner"], or [] for everyone.`

  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GATEWAY_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4-6',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) { console.error(`draft failed for #${pr.number}:`, r.status); return null }
  const data = await r.json()
  try {
    return JSON.parse(data.choices[0].message.content)
  } catch {
    return null
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE_URL/SUPABASE_SERVICE_KEY'); process.exit(1) }
  if (!GATEWAY_KEY) { console.error('Missing AI_GATEWAY_API_KEY'); process.exit(1) }

  const since = await lastGeneratedAt()
  const prs = mergedPrsSince(since).filter((pr) => !SKIP_PREFIX_RE.test(pr.title))
  console.log(`${prs.length} candidate PR(s) merged since ${since}`)

  const inserts = []
  for (const pr of prs) {
    const draft = await draftEntry(pr)
    if (!draft || draft.skip || !draft.summary) continue
    inserts.push({
      summary: draft.summary.slice(0, 500),
      roles: Array.isArray(draft.roles) ? draft.roles : [],
      source_pr: pr.number,
      created_at: pr.mergedAt,
    })
  }

  console.log(`${inserts.length} entr${inserts.length === 1 ? 'y' : 'ies'} to write`)
  if (DRY_RUN) { console.log(JSON.stringify(inserts, null, 2)); return }
  if (!inserts.length) return

  const r = await sb('product_updates', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(inserts),
  })
  if (!r.ok) console.error('insert failed:', r.status, (await r.text()).slice(0, 300))
  else console.log('done')
}

main().catch((e) => { console.error(e); process.exit(1) })
