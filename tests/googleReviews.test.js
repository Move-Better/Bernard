import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { slug: 'movebetter' }
vi.mock('../api/_lib/workspaceContext.js', () => ({ workspaceContext: async () => ({ id: 'w1', slug: state.slug, clerk_org_id: 'o1' }) }))
vi.mock('../api/_lib/auth.js', () => ({ requireRole: async () => ({ ok: true }) }))
vi.mock('../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))

const { shapeSummary, getReviewsSummary, REVIEWS_WORKSPACES, _resetReviewsCache } = await import('../api/_lib/googleReviews.js')
const { default: handler } = await import('../api/_routes/insights/google-reviews.js')

const FILE = {
  updated: '2026-11-14',
  locations: { portland: { rating: 5.0, count: 130 }, vancouver: { rating: 5.0, count: 39 } },
  reviews: [{ id: 'g1', text: 'Verbatim patient words', reviewer_name: 'Someone' }],
}
const okFetch = () => vi.fn(async () => ({ ok: true, status: 200, json: async () => FILE }))

function call() {
  const out = {}
  const res = { status(c) { out.status = c; return res }, json(b) { out.body = b; return res } }
  return handler({ method: 'GET', headers: {} }, res).then(() => out)
}

beforeEach(() => { _resetReviewsCache(); state.slug = 'movebetter'; process.env.GITHUB_REVIEWS_TOKEN = 't'.repeat(40); vi.unstubAllGlobals() })

describe('shapeSummary', () => {
  it('returns per-clinic rating and count plus a count-weighted combined row', () => {
    const s = shapeSummary({ updated: '2026-11-14', locations: { portland: { rating: 5, count: 130 }, vancouver: { rating: 4, count: 30 } } })
    expect(s.locations).toEqual([
      { key: 'portland', label: 'Portland', rating: 5, count: 130 },
      { key: 'vancouver', label: 'Vancouver', rating: 4, count: 30 },
    ])
    expect(s.combined.count).toBe(160)
    expect(s.combined.rating).toBeCloseTo((5 * 130 + 4 * 30) / 160)
    expect(s.updated).toBe('2026-11-14')
  })
  it('never carries review text, names or photos', () => {
    expect(JSON.stringify(shapeSummary(FILE))).not.toMatch(/Verbatim|Someone|reviews|photo/)
  })
  it('rejects a file that is not the expected shape', () => {
    for (const bad of [null, {}, { locations: {} }, { locations: { portland: { rating: 9, count: 1 } } }, { locations: { portland: { rating: 5, count: 1.5 } } }]) {
      expect(shapeSummary(bad)).toBe(null)
    }
  })
})

describe('getReviewsSummary', () => {
  it('sends the bearer token to the Movebetterco contents API and caches for an hour', async () => {
    const f = okFetch()
    const a = await getReviewsSummary({ fetchImpl: f, now: 1000 })
    const b = await getReviewsSummary({ fetchImpl: f, now: 1000 + 59 * 60 * 1000 })
    expect(a.combined.count).toBe(169)
    expect(b).toBe(a)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/repos/Move-Better/Movebetterco/contents/data/google-reviews.json?ref=main')
    expect(init.headers.Authorization).toMatch(/^Bearer t+$/)
    await getReviewsSummary({ fetchImpl: f, now: 1000 + 61 * 60 * 1000 })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('returns null and does not cache a failure', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 404 }))
    expect(await getReviewsSummary({ fetchImpl: bad, now: 1 })).toBe(null)
    expect(await getReviewsSummary({ fetchImpl: okFetch(), now: 2 })).not.toBe(null)
  })
  it('returns null without a token and without calling out', async () => {
    const f = okFetch()
    expect(await getReviewsSummary({ fetchImpl: f, token: '' })).toBe(null)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('GET /api/insights/google-reviews', () => {
  it('is only open to Move Better', () => expect([...REVIEWS_WORKSPACES]).toEqual(['movebetter']))
  it('gives another workspace { enabled: false } and never fetches the reviews', async () => {
    state.slug = 'some-other-clinic'
    const f = okFetch()
    vi.stubGlobal('fetch', f)
    const r = await call()
    expect(r).toEqual({ status: 200, body: { enabled: false } })
    expect(f).not.toHaveBeenCalled()
  })
  it('gives Move Better the totals', async () => {
    vi.stubGlobal('fetch', okFetch())
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.body.enabled).toBe(true)
    expect(r.body.locations.map((l) => l.count)).toEqual([130, 39])
  })
  it('reports unavailable rather than failing when the source is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    expect((await call()).body).toEqual({ enabled: true, error: 'unavailable' })
  })
})
