// The interview completion cascade runs once per interview, not once per save.
//
// PATCH /api/db/interviews fired the whole cascade (concepts, summary, style
// ledger, RAG index, voice phrases, moment bank, Strategist replan, region,
// book-stale) on EVERY request carrying outputs + status 'completed'. A retried
// or repeated save paid for every AI call again and bumped concept and
// voice-phrase weights twice (audit 2026-11-18, full, P2). The content_items
// fan-out must stay re-entrant so a late output still lands
// (interviewOutputFanout.test.js); only the rest is gated.
//
// The handler is driven for real against a fake PostgREST that keeps the
// interview's status and the content_items platforms, so the first-completion
// filter and the fan-out dedup both behave as they would against prod.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceContext: async () => ({ id: 'ws-a', slug: 'a', clerk_org_id: 'org_a', enabled_outputs: [] }),
}))
vi.mock('../../api/_lib/auth.js', () => ({
  requireRole: async () => ({ ok: true, userId: 'user_1', role: 'admin', isOrgAdmin: true }),
  requireCapability: async () => ({ ok: true }),
}))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))

const calls = vi.hoisted(() => ({}))
const spy = (name) => async (...args) => { calls[name] = (calls[name] || 0) + 1; return args }
vi.mock('../../api/_lib/conceptExtractor.js', async (orig) => ({
  ...(await orig()), extractConcepts: spy('concepts'),
}))
vi.mock('../../api/_lib/interviewSummarizer.js', () => ({ summarizeInterview: spy('summary') }))
vi.mock('../../api/_lib/interviewStyleClassifier.js', () => ({ classifyAndStoreInterviewStyle: spy('style') }))
vi.mock('../../api/_lib/topicRegion.js', () => ({ classifyAndStoreInterviewRegion: spy('region') }))
vi.mock('../../api/_lib/voicePhraseExtractor.js', () => ({ extractVoicePhrases: spy('voice') }))
vi.mock('../../api/_lib/bookStale.js', () => ({ markBookStale: spy('book') }))
vi.mock('../../api/_lib/practiceMemoryRag.js', () => ({ indexInterviewTranscriptFull: spy('rag') }))
vi.mock('../../api/_lib/momentExtract.js', () => ({ extractAndBankMoments: spy('moments') }))
vi.mock('../../api/_lib/strategistPlan.js', () => ({ replanWorkspaceWeek: spy('replan') }))
vi.mock('../../api/_lib/citations/runForContentItem.js', () => ({ runCitationEnrichmentForContentItem: spy('citations') }))
const pending = vi.hoisted(() => [])
vi.mock('@vercel/functions', () => ({ waitUntil: (p) => { pending.push(p) } }))

const { default: interviews } = await import('../../api/_routes/db/interviews.js')

const IV = '11111111-1111-4111-8111-111111111111'
const STAFF = '44444444-4444-4444-8444-444444444444'
const CASCADE = ['concepts', 'summary', 'style', 'rag', 'voice', 'moments', 'replan', 'region', 'book']

let db
function json(body, status = 200) { return new Response(JSON.stringify(body), { status }) }

// A fake PostgREST: one interview whose status changes on PATCH, and a
// content_items table whose rows are what the fan-out dedups against.
// `staleStatusReads` lets a test serve a stale 'in_progress' on the pre-check
// read, the way a concurrent completion sees the row before the winner writes.
function fakeFetch(url, init = {}) {
  const u = new URL(String(url), 'http://test.local')
  const table = u.pathname.split('/').pop()
  const method = init.method || 'GET'
  if (table === 'interviews' && method === 'GET') {
    const status = db.staleStatusReads > 0 ? (db.staleStatusReads--, 'in_progress') : db.status
    return Promise.resolve(json([{
      owner_id: 'user_1', staff_id: STAFF, topic: 'Hips', status, region: db.region, theme: null,
      messages: [{ role: 'user', content: 'I tell every runner to load the hip.' }], cleaned_messages: null,
    }]))
  }
  if (table === 'interviews' && method === 'PATCH') {
    const body = JSON.parse(init.body)
    const guard = u.searchParams.get('or')
    if (guard && db.status === 'completed') return Promise.resolve(json([]))
    if (body.status) db.status = body.status
    return Promise.resolve(json([{ id: IV, status: db.status }]))
  }
  if (table === 'content_items' && method === 'GET') {
    return Promise.resolve(json(db.items.map((r) => ({ platform: r.platform, id: r.platform }))))
  }
  if (table === 'content_items' && method === 'POST') {
    const [row] = JSON.parse(init.body)
    db.items.push(row)
    return Promise.resolve(json([], 201))
  }
  if (table === 'staff') return Promise.resolve(json([{ name: 'Dr A', blog_review_enabled: false }]))
  if (table === 'workspaces') return Promise.resolve(json([{ cadence_policy: null, enabled_outputs: [], moment_bank_planning_enabled: false }]))
  return Promise.resolve(json([]))
}

function res() {
  const r = { statusCode: 0, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.setHeader = () => r
  return r
}

async function complete(outputs) {
  const r = res()
  await interviews({ method: 'PATCH', url: `/api/db/interviews?id=${IV}`, headers: {}, body: { outputs, status: 'completed' } }, r)
  await Promise.all(pending.splice(0))
  return r
}

describe('interview completion cascade', () => {
  beforeEach(() => {
    db = { status: 'in_progress', region: null, items: [], staleStatusReads: 0 }
    for (const k of Object.keys(calls)) delete calls[k]
    pending.length = 0
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    for (const m of ['error', 'info', 'warn']) vi.spyOn(console, m).mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('runs every cascade block once on the first completion', async () => {
    const r = await complete({ blogPost: 'body' })
    expect(r.statusCode).toBe(200)
    for (const name of CASCADE) expect(calls[name], name).toBe(1)
    expect(db.items.map((i) => i.platform)).toEqual(['blog'])
  })

  // One assertion per block, so a mutation that ungates any single block
  // fails its own named test.
  for (const name of CASCADE) {
    it(`a repeated complete PATCH does not re-run ${name}`, async () => {
      await complete({ blogPost: 'body' })
      await complete({ blogPost: 'body' })
      expect(calls[name]).toBe(1)
    })
  }

  it('a repeated complete PATCH writes no second content_items row', async () => {
    await complete({ blogPost: 'body' })
    await complete({ blogPost: 'body' })
    expect(db.items.map((i) => i.platform)).toEqual(['blog'])
    expect(calls.citations).toBe(1)
  })

  it('a late output still materialises, inheriting the stored region, with no cascade', async () => {
    await complete({ blogPost: 'body' })
    db.region = 'hip'
    await complete({ blogPost: 'body', emailNewsletter: 'news' })
    expect(db.items.map((i) => i.platform)).toEqual(['blog', 'email'])
    expect(db.items[1].region).toBe('hip')
    for (const name of CASCADE) expect(calls[name], name).toBe(1)
  })

  it('a concurrent completion that read a stale status does not re-run the cascade', async () => {
    await complete({ blogPost: 'body' })
    // The second request's pre-check sees 'in_progress' (it read before the
    // first request wrote), so only the filtered PATCH can tell it lost.
    db.staleStatusReads = 1
    const r = await complete({ blogPost: 'body' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toEqual({ id: IV, status: 'completed' })
    for (const name of CASCADE) expect(calls[name], name).toBe(1)
  })
})
