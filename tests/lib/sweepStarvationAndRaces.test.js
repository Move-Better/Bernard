// Starvation and race defects in the scheduled sweeps (audit 2026-11-18, P2):
//  - sweepDriftedAnswers ordered never-rechecked answers first, so `limit`
//    recently published (ineligible) answers filled the page every run and the
//    eligible ones behind them were never re-scored;
//  - both answer sweeps PATCHed without a status guard, so a retract made
//    while the slow re-draft / re-score ran was overwritten;
//  - sync-published-status took the OLDEST overdue posts first, so rows that
//    stay 'scheduled' for good filled every slot and newer posts went unchecked.
// fetch is a small fake PostgREST that applies the filters these callers send.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/_lib/scoreAnswerFidelity.js', () => ({
  ANSWER_GATE: 7.5,
  scoreAnswerFidelity: vi.fn(async () => ({ ok: true, overall: 9, score100: 90, voiceAudit: {} })),
}))
vi.mock('../../api/_lib/embeddings.js', () => ({ embedText: async () => [1, 0] }))
const draftAnswer = vi.fn()
vi.mock('../../api/_lib/producer/draftAnswer.js', () => ({ draftAnswer: (...a) => draftAnswer(...a) }))
vi.mock('../../api/_lib/auth.js', () => ({ verifyCronSecret: () => true }))
vi.mock('../../api/_lib/notifyPublishFailure.js', () => ({ notifyPublishFailure: async () => {} }))
vi.mock('../../api/_lib/agentActions.js', () => ({ recordAgentAction: async () => {} }))
vi.mock('../../api/_lib/social/bundlePublisher.js', () => ({
  BundlePublisher: class {
    async getPostStatus({ postId }) {
      return postId === 'fresh'
        ? { status: 'POSTED', isPosted: true, postedAt: '2026-11-19T00:00:00Z' }
        : { status: 'DELETED', isPosted: false, isFailed: true }
    }
  },
}))

process.env.SUPABASE_URL = 'http://supabase.test'
process.env.SUPABASE_SERVICE_KEY = 'service-key'

const { scoreAnswerFidelity } = await import('../../api/_lib/scoreAnswerFidelity.js')
const { sweepDriftedAnswers } = await import('../../api/_lib/sweepDriftedAnswers.js')
const { sweepSupersededAnswers } = await import('../../api/_lib/sweepSupersededAnswers.js')
const { default: syncPublished } = await import('../../api/_routes/cron/sync-published-status.js')

const json = (b) => new Response(JSON.stringify(b), { status: 200 })
const DAY = 86_400_000
const NOW = Date.parse('2026-11-19T00:00:00Z')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

// Applies `col=eq.x`, `col=lte.x`, `col=lt.x`, `col=gte.x`, `col=is.null`,
// `col=not.is.null`, the drift sweep's one `or=(...)` shape, order and limit.
function applyQuery(rows, params) {
  let out = rows.filter((r) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'or'].includes(k)) continue
      if (k === 'workspace_id' && v.startsWith('in.')) continue
      const cell = r[k]
      if (v.startsWith('eq.') && String(cell) !== v.slice(3)) return false
      if (v.startsWith('lte.') && !(cell != null && cell <= v.slice(4))) return false
      if (v.startsWith('lt.') && !(cell != null && cell < v.slice(3))) return false
      if (v.startsWith('gte.') && !(cell != null && cell >= v.slice(4))) return false
      if (v === 'is.null' && cell != null) return false
      if (v === 'not.is.null' && cell == null) return false
    }
    const or = params.get('or')
    if (or) {
      const m = or.match(/^\(voice_rechecked_at\.lte\.([^,]+),and\(voice_rechecked_at\.is\.null,published_at\.lte\.([^)]+)\)\)$/)
      if (!m) throw new Error(`unexpected or: ${or}`)
      const ok = (r.voice_rechecked_at && r.voice_rechecked_at <= m[1]) || (!r.voice_rechecked_at && r.published_at <= m[2])
      if (!ok) return false
    }
    return true
  })
  const order = params.get('order')
  if (order) {
    const keys = order.split(',').map((o) => { const [col, dir, nulls] = o.split('.'); return { col, desc: dir === 'desc', nullsFirst: nulls === 'nullsfirst' } })
    out = [...out].sort((a, b) => {
      for (const { col, desc, nullsFirst } of keys) {
        const x = a[col]; const y = b[col]
        if (x == y) continue // eslint-disable-line eqeqeq
        if (x == null) return nullsFirst ? -1 : 1
        if (y == null) return nullsFirst ? 1 : -1
        return (x < y ? -1 : 1) * (desc ? -1 : 1)
      }
      return 0
    })
  }
  const limit = Number(params.get('limit'))
  return limit ? out.slice(0, limit) : out
}

function fakeDb(tables) {
  return vi.fn(async (url, init = {}) => {
    const u = new URL(String(url))
    const table = u.pathname.split('/').pop()
    const rows = tables[table] || []
    const hit = applyQuery(rows, u.searchParams)
    if ((init.method || 'GET') === 'PATCH') {
      const body = JSON.parse(init.body)
      for (const r of hit) Object.assign(r, body)
      return json(hit)
    }
    return json(hit)
  })
}

beforeEach(() => {
  for (const m of ['error', 'info', 'warn', 'log']) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('sweepDriftedAnswers', () => {
  it('reaches an eligible answer behind a page of recently published ones', async () => {
    const answers = []
    for (let i = 0; i < 30; i++) {
      answers.push({ id: `new${i}`, workspace_id: 'ws', status: 'published', movebetterco_slug: 's', published_at: iso(5 * DAY), voice_rechecked_at: null })
    }
    answers.push({ id: 'old', workspace_id: 'ws', status: 'published', movebetterco_slug: 's', published_at: iso(200 * DAY), voice_rechecked_at: iso(120 * DAY) })
    vi.stubGlobal('fetch', fakeDb({ answers }))
    const out = await sweepDriftedAnswers({ id: 'ws' }, { limit: 25, now: NOW })
    expect(out.checked).toBe(1)
    expect(answers.find((a) => a.id === 'old').voice_rechecked_at).toBe(new Date(NOW).toISOString())
  })
})

describe('sweepDriftedAnswers status guard', () => {
  it('does not re-queue an answer retracted while it was being re-scored', async () => {
    const answer = { id: 'a1', workspace_id: 'ws', status: 'published', movebetterco_slug: 's', published_at: iso(200 * DAY), voice_rechecked_at: null }
    vi.stubGlobal('fetch', fakeDb({ answers: [answer] }))
    scoreAnswerFidelity.mockImplementationOnce(async () => {
      answer.status = 'retracted'
      return { ok: true, overall: 5, score100: 50, voiceAudit: {} } // below the gate: would re-queue
    })
    await sweepDriftedAnswers({ id: 'ws' }, { now: NOW })
    expect(answer.status).toBe('retracted')
  })
})

describe('sweepSupersededAnswers', () => {
  it('does not overwrite an answer retracted while it was being re-drafted', async () => {
    const answer = { id: 'a1', workspace_id: 'ws', staff_id: 'st', status: 'published', movebetterco_slug: 's', question: 'q' }
    vi.stubGlobal('fetch', fakeDb({
      practice_memory_supersessions: [{ id: 'sup', workspace_id: 'ws', status: 'confirmed', staff_id: 'st', new_chunk_id: 'c' }],
      practice_memory_chunks: [{ id: 'c', workspace_id: 'ws', embedding: [1, 0] }],
      answers: [answer],
    }))
    draftAnswer.mockImplementation(async () => {
      answer.status = 'retracted' // the clinician retracts mid-draft
      return { answer_lead: 'new', body: 'new', voiceFidelityScore: 80, voiceAudit: {} }
    })
    const out = await sweepSupersededAnswers({ ws: { id: 'ws' }, supersessionId: 'sup' })
    expect(answer.status).toBe('retracted')
    expect(out.affected).toBe(0)
  })
})

describe('sync-published-status', () => {
  it('checks a newly overdue post even when 100+ older rows are stuck', async () => {
    // The cron reads the real clock (now, now - 30 days), so these do too.
    const ago = (ms) => new Date(Date.now() - ms).toISOString()
    const ws = '55555555-5555-4555-8555-555555555555'
    const items = []
    for (let i = 0; i < 120; i++) {
      items.push({ id: `old${i}`, workspace_id: ws, status: 'scheduled', platform_post_id: `gone${i}`, scheduled_at: ago((20 * DAY) - i * 60_000) })
    }
    const fresh = { id: 'fresh-row', workspace_id: ws, status: 'scheduled', platform_post_id: 'fresh', scheduled_at: ago(60 * 60_000) }
    items.push(fresh)
    vi.stubGlobal('fetch', fakeDb({
      workspaces: [{ id: ws, status: 'active', bundle_team_id: 'team' }],
      content_items: items,
    }))
    const r = { statusCode: 0, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    await syncPublished({ method: 'GET', headers: {} }, r)
    expect(fresh.status).toBe('published')
  })
})
