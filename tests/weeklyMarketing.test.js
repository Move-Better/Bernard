import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { slug: 'movebetter', ws: null, limitOk: true }
const calls = { rest: [], ga: [], gsc: [] }
const KEY = 'w'.repeat(32)

vi.mock('../api/_lib/sentry.js', () => ({ withSentry: (h) => h }))
vi.mock('../api/_lib/workspaceScope.js', () => ({
  workspaceScope: async () => (state.slug === null ? null : {
    column: 'workspace_id', id: 'w1',
    workspace: { id: 'w1', slug: state.slug, ga4_property_id: '123', gsc_site_url: 'sc-domain:x.co', booking_url: 'https://book.janeapp.com/x', ...state.ws },
  }),
}))
vi.mock('../api/_lib/ratelimit.js', () => ({
  enforceLimit: async (_req, res) => { if (!state.limitOk) { res.status(429).json({ error: 'rate_limited' }); return false } return true },
}))
vi.mock('../api/_lib/credentialCrypto.js', () => ({ decryptSecret: () => 'decrypted' }))
vi.mock('../api/_lib/supabaseRest.js', () => ({
  supabaseRest: async (path, init = {}) => {
    calls.rest.push({ path, method: init.method || 'GET' })
    if (path.startsWith('workspace_credentials')) return { ok: true, json: async () => [{ secret_ciphertext: 'x', config: {} }] }
    if (path.startsWith('content_items')) return { ok: true, json: async () => [{ platform: 'blog' }, { platform: 'instagram' }, { platform: 'instagram' }] }
    if (path.startsWith('interviews')) return { ok: true, json: async () => [{ kind: 'topic', status: 'completed' }, { kind: 'topic', status: 'completed' }, { kind: 'topic', status: 'draft' }] }
    return { ok: false, json: async () => [] }
  },
}))
vi.mock('../api/_lib/ga4.js', () => ({
  fetchGA4TotalSessions: vi.fn(async () => { calls.ga.push('sessions'); return 541 }),
  fetchGA4OutboundClickCount: vi.fn(async () => { calls.ga.push('booknow'); return 34 }),
}))
vi.mock('../api/_lib/searchConsole.js', () => ({
  fetchSearchTotalsByDate: vi.fn(async () => { calls.gsc.push('total'); return [{ date: '2026-11-02', clicks: 9, impressions: 200 }, { date: '2026-11-08', clicks: 5, impressions: 300 }, { date: '2026-11-09', clicks: 1, impressions: 999 }] }),
  fetchNonBrandedSearchTotalsByDate: vi.fn(async () => { calls.gsc.push('nb'); return [{ date: '2026-11-04', clicks: 2, impressions: 10 }, { date: '2026-11-08', clicks: 3, impressions: 10 }] }),
}))

const ga = await import('../api/_lib/ga4.js')
const gsc = await import('../api/_lib/searchConsole.js')
const { default: handler, weekFor, pacificDayStartUtc } = await import('../api/_routes/insights/weekly-marketing.js')

function call({ method = 'GET', auth = `Bearer ${KEY}`, qs = 'week_ending=2026-11-08' } = {}) {
  const out = {}
  const res = { status(c) { out.status = c; return res }, json(b) { out.body = b; return res }, setHeader() {} }
  const req = { method, headers: auth === null ? {} : { authorization: auth }, url: `/api/insights/weekly-marketing?${qs}` }
  return handler(req, res).then(() => out)
}

beforeEach(() => {
  state.slug = 'movebetter'; state.ws = null; state.limitOk = true
  calls.rest = []; calls.ga = []; calls.gsc = []
  process.env.WEEKLY_MARKETING_KEY = KEY
  vi.mocked(ga.fetchGA4TotalSessions).mockImplementation(async () => { calls.ga.push('sessions'); return 541 })
  vi.mocked(ga.fetchGA4OutboundClickCount).mockImplementation(async () => { calls.ga.push('booknow'); return 34 })
})

describe('who may read', () => {
  it('refuses a missing, wrong or unset key and touches no data', async () => {
    for (const auth of [null, `Bearer ${KEY}x`, 'Bearer nope', KEY]) {
      const r = await call({ auth })
      expect(r.status).toBe(401)
    }
    delete process.env.WEEKLY_MARKETING_KEY
    expect((await call()).status).toBe(401)
    expect(calls.rest).toEqual([])
    expect(calls.ga).toEqual([])
    expect(calls.gsc).toEqual([])
  })
  it('refuses a workspace outside the allowlist, even with the right key', async () => {
    state.slug = 'someone-else'
    const r = await call()
    expect(r.status).toBe(404)
    expect(calls.rest).toEqual([])
  })
  it('404s when the host resolves to no workspace', async () => {
    state.slug = null
    expect((await call()).status).toBe(404)
  })
  it('only answers GET', async () => {
    expect((await call({ method: 'POST' })).status).toBe(405)
    expect((await call({ method: 'DELETE' })).status).toBe(405)
  })
  it('stops when rate limited', async () => {
    state.limitOk = false
    expect((await call()).status).toBe(429)
    expect(calls.rest).toEqual([])
  })
})

describe('week_ending', () => {
  it('accepts only a real Sunday, YYYY-MM-DD', async () => {
    for (const bad of ['', 'week_ending=2026-11-07', 'week_ending=2026-11-09', 'week_ending=2026-11-8', 'week_ending=2026-02-30', 'week_ending=garbage']) {
      const r = await call({ qs: bad })
      expect(r.status, bad).toBe(400)
      expect(r.body.error).toBe('invalid_week_ending')
    }
    expect((await call()).status).toBe(200)
  })
  it('refuses a week that is not over yet (Pacific)', async () => {
    const future = '2099-01-04'
    expect(new Date(`${future}T00:00:00Z`).getUTCDay()).toBe(0)
    const r = await call({ qs: `week_ending=${future}` })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('week_not_finished')
  })
  it('is Monday through Sunday, and the row window is Pacific midnight to Pacific midnight', () => {
    const w = weekFor('2026-11-08')
    expect([w.start, w.end]).toEqual(['2026-11-02', '2026-11-08'])
    // DST ended 2026-11-01, so Mon 11-02 00:00 PST = 08:00Z and Mon 11-09 00:00 PST = 08:00Z.
    expect(w.startUtc.toISOString()).toBe('2026-11-02T08:00:00.000Z')
    expect(w.endUtc.toISOString()).toBe('2026-11-09T08:00:00.000Z')
    // The week before spans the end of DST: Mon 10-26 00:00 PDT = 07:00Z.
    expect(weekFor('2026-11-01').startUtc.toISOString()).toBe('2026-10-26T07:00:00.000Z')
    expect(weekFor('2026-11-01').endUtc.toISOString()).toBe('2026-11-02T08:00:00.000Z')
    expect(pacificDayStartUtc('2026-03-08').toISOString()).toBe('2026-03-08T08:00:00.000Z')
  })
  it('puts Sunday 11:30pm Pacific inside the week and Monday 00:30 outside it', () => {
    const w = weekFor('2026-11-08')
    const sundayLate = new Date('2026-11-09T07:30:00Z') // Sun 11:30pm PST
    const mondayEarly = new Date('2026-11-09T08:30:00Z') // Mon 00:30 PST
    expect(sundayLate >= w.startUtc && sundayLate < w.endUtc).toBe(true)
    expect(mondayEarly >= w.startUtc && mondayEarly < w.endUtc).toBe(false)
  })
})

describe('response', () => {
  it('returns the numbers, components, dates and computed_at', async () => {
    const { status, body } = await call()
    expect(status).toBe(200)
    expect(body.workspace).toBe('movebetter')
    expect([body.week_start, body.week_ending]).toEqual(['2026-11-02', '2026-11-08'])
    expect(Number.isNaN(Date.parse(body.computed_at))).toBe(false)
    expect(body.numbers.website_sessions).toEqual({ value: 541, reason: null })
    expect(body.numbers.book_now_clicks).toEqual({ value: 34, reason: null })
    // 200 + 300 only: the 11-09 row is outside the week.
    expect(body.numbers.search_impressions).toEqual({ value: 500, reason: null })
    expect(body.numbers.non_branded_search_clicks).toEqual({ value: 5, reason: null })
    expect(body.components.posts_published_by_platform.value).toEqual({ blog: 1, instagram: 2 })
    expect(body.components.interviews_by_kind_and_status.value).toEqual([
      { kind: 'topic', status: 'completed', count: 2 }, { kind: 'topic', status: 'draft', count: 1 },
    ])
    expect(body.data_status).toEqual({ website: 'complete', search: 'complete' })
    expect(JSON.stringify(body)).not.toMatch(/total_views|engagement|reach/i)
  })
  it('filters every query by workspace and reads timestamped rows by the Pacific window', async () => {
    await call()
    for (const c of calls.rest) {
      expect(c.method).toBe('GET')
      expect(c.path).toContain('workspace_id=eq.w1')
    }
    const posts = calls.rest.find((c) => c.path.startsWith('content_items')).path
    expect(posts).toContain(encodeURIComponent('2026-11-02T08:00:00.000Z'))
    expect(posts).toContain(encodeURIComponent('2026-11-09T08:00:00.000Z'))
    expect(posts).toContain('status=eq.published')
  })
  it('marks a week Search Console has not reached the Sunday of as not complete', async () => {
    vi.mocked(gsc.fetchSearchTotalsByDate).mockImplementationOnce(async () => [{ date: '2026-11-05', clicks: 1, impressions: 50 }])
    const { body } = await call()
    expect(body.data_status.search).toBe('may_be_incomplete')
  })
})

describe('a failed source is null with a reason, never 0', () => {
  it('GA4 sessions and Book Now', async () => {
    vi.mocked(ga.fetchGA4TotalSessions).mockImplementation(async () => { throw new Error('boom') })
    vi.mocked(ga.fetchGA4OutboundClickCount).mockImplementation(async () => { throw new Error('boom') })
    const { body } = await call()
    expect(body.numbers.website_sessions).toEqual({ value: null, reason: 'ga4_fetch_failed' })
    expect(body.numbers.book_now_clicks).toEqual({ value: null, reason: 'ga4_fetch_failed' })
  })
  it('Search Console', async () => {
    vi.mocked(gsc.fetchSearchTotalsByDate).mockImplementationOnce(async () => { throw new Error('boom') })
    const { body } = await call()
    expect(body.numbers.search_impressions).toEqual({ value: null, reason: 'gsc_fetch_failed' })
    expect(body.numbers.non_branded_search_clicks).toEqual({ value: null, reason: 'gsc_fetch_failed' })
    expect(body.data_status.search).toBe('may_be_incomplete')
  })
  it('sources that are not connected', async () => {
    state.ws = { ga4_property_id: null, gsc_site_url: null, booking_url: null }
    const { body } = await call()
    expect(body.numbers.website_sessions).toEqual({ value: null, reason: 'ga4_not_connected' })
    expect(body.numbers.book_now_clicks.value).toBe(null)
    expect(body.numbers.search_impressions).toEqual({ value: null, reason: 'gsc_not_connected' })
  })
  it('no booking url nulls only Book Now', async () => {
    state.ws = { booking_url: null }
    const { body } = await call()
    expect(body.numbers.book_now_clicks).toEqual({ value: null, reason: 'no_booking_url' })
    expect(body.numbers.website_sessions.value).toBe(541)
  })
})
