import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// "Fixed — you reported" banners expire NOTICE_WINDOW_DAYS after the fix.
// Before 2026-11-09 they stayed on Home until dismissed; a July test row was
// still showing in November (simplicity audit).

vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceContext: async () => ({ id: 'ws-1', clerk_org_id: 'org_1' }),
}))
vi.mock('../../api/_lib/auth.js', () => ({
  requireRole: async () => ({ ok: true, userId: 'user_1' }),
}))

const { default: handler, NOTICE_WINDOW_DAYS } = await import('../../api/_routes/feedback/my-notices.js')

function res() {
  const r = { statusCode: 0, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  return r
}

describe('my-notices only returns recently fixed reports', () => {
  let urls
  beforeEach(() => {
    urls = []
    vi.stubGlobal('fetch', async (url) => {
      urls.push(String(url))
      return { ok: true, json: async () => [] }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the window at two weeks', () => {
    expect(NOTICE_WINDOW_DAYS).toBe(14)
  })

  it('bounds resolved_at to the window instead of "any resolved row"', async () => {
    const before = Date.now()
    const r = res()
    await handler({ method: 'GET', headers: {} }, r)
    expect(r.statusCode).toBe(200)
    expect(urls).toHaveLength(1)
    // SUPABASE_URL is unset under test, so the captured URL has no host.
    const u = new URL(urls[0], 'http://test.local')
    const resolved = u.searchParams.get('resolved_at')
    expect(resolved, 'resolved_at must be a lower bound, not just not-null').toMatch(/^gte\./)
    const since = Date.parse(resolved.slice(4))
    const expected = before - NOTICE_WINDOW_DAYS * 86_400_000
    expect(Math.abs(since - expected)).toBeLessThan(5_000)
    expect(u.searchParams.get('acknowledged_at')).toBe('is.null')
    expect(u.searchParams.get('user_id')).toBe('eq.user_1')
  })
})
