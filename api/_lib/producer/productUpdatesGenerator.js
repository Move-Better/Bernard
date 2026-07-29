// Core logic for the "what's new in Bernard" feed (P3 of ProducerHome —
// .claude/decisions.md 2026-07-29). Shared by the nightly cron
// (api/_routes/cron/generate-product-updates.js) and the local dry-run
// script (scripts/generate-product-updates.mjs) — one implementation, not
// two drifting copies.
//
// Reads merged PRs on Move-Better/Bernard via the GitHub REST API (no `gh`
// CLI — this runs inside a Vercel function, which has no shell access to
// it), asks the model to write a plain-language, role-tagged entry per
// user-visible PR, and inserts the results into product_updates
// (migration 193). Replaces the hand-maintained public/release-notes.json
// for role-targeted announcements.
import { generateObject } from 'ai'
import { z } from 'zod'

const MODEL = 'anthropic/claude-sonnet-4-6'
const REPO_OWNER = 'Move-Better'
const REPO_NAME = 'Bernard'
const SKIP_PREFIX_RE = /^(chore|test|docs|ci|refactor)(\(|:)/i

const schema = z.object({
  skip: z.boolean().describe('true if this PR has no user-visible effect for a producer or clinician (pure infra/internal)'),
  summary: z.string().max(500).describe('One plain-language sentence: what changed, from the user’s side of the screen. No PR numbers, no jargon.'),
  roles: z.array(z.enum(['producer', 'clinician', 'owner'])).describe('Who cares. Empty array means everyone.'),
})

const SYSTEM = `You write one-sentence "what's new" entries for Bernard, a chiropractic-clinic content-production platform. Given a merged PR's title and description, decide whether a PRODUCER (operational editor: approves posts, reviews video clips, monitors publishing) or CLINICIAN (records interviews, writes/approves patient-facing content) would notice this change using the app day-to-day. If it's pure infra/internal/no user-visible effect, set skip=true. Otherwise write ONE plain-language sentence in active voice describing what changed from the user's side of the screen, and tag which roles care (empty array = everyone).`

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
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

// GitHub REST — list recently-merged PRs. Uses the plain pulls endpoint
// (state=closed, sorted by update time) rather than the search API, since
// search doesn't return the PR body reliably and this needs it for context.
async function mergedPrsSince(isoDate, token) {
  const out = []
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=closed&sort=updated&direction=desc&per_page=50&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    )
    if (!r.ok) { console.error('[productUpdatesGenerator] pulls fetch failed:', r.status); break }
    const rows = await r.json()
    if (!rows.length) break
    let sawOlder = false
    for (const pr of rows) {
      if (!pr.merged_at) continue
      if (Date.parse(pr.merged_at) <= Date.parse(isoDate)) { sawOlder = true; continue }
      out.push({ number: pr.number, title: pr.title, body: pr.body, mergedAt: pr.merged_at })
    }
    // Results are sorted by UPDATE time, not merge time, so keep paging a
    // little past the first older row rather than stopping immediately —
    // cheap insurance against an out-of-order edge case, capped at 3 pages.
    if (sawOlder && page > 1) break
  }
  return out
}

async function draftEntry(pr) {
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema,
      system: SYSTEM,
      prompt: `PR title: ${pr.title}\n\nPR body:\n${(pr.body || '').slice(0, 1500)}`,
    })
    return object
  } catch (e) {
    console.error(`[productUpdatesGenerator] draft failed for #${pr.number}:`, e?.message)
    return null
  }
}

/**
 * @param {{ dryRun?: boolean }} opts
 * @returns {Promise<{ candidates: number, inserted: number, entries: object[] }>}
 */
export async function generateProductUpdates({ dryRun = false } = {}) {
  const token = process.env.GITHUB_TOKEN_BERNARD_READ
  if (!token) throw new Error('GITHUB_TOKEN_BERNARD_READ not set')

  const since = await lastGeneratedAt()
  const prs = (await mergedPrsSince(since, token)).filter((pr) => !SKIP_PREFIX_RE.test(pr.title))

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

  if (!dryRun && inserts.length) {
    const r = await sb('product_updates', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(inserts),
    })
    if (!r.ok) throw new Error(`insert failed: ${r.status} ${(await r.text()).slice(0, 300)}`)
  }

  return { candidates: prs.length, inserted: dryRun ? 0 : inserts.length, entries: inserts }
}
