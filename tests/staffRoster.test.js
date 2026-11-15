import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { slug: 'movebetter', rows: [{ name: 'Dr. Q', legal_name: 'Michael Quasney', user_id: 'secret' }, { name: 'Zach Cullen', legal_name: null }], dbOk: true }
const calls = { rest: [] }
const KEY = 'w'.repeat(32)

vi.mock('../api/_lib/sentry.js', () => ({ withSentry: (h) => h }))
vi.mock('../api/_lib/workspaceScope.js', () => ({
  workspaceScope: async () => (state.slug === null ? null : { column: 'workspace_id', id: 'w1', workspace: { id: 'w1', slug: state.slug } }),
}))
vi.mock('../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))
vi.mock('../api/_lib/supabaseRest.js', () => ({
  supabaseRest: async (path, init = {}) => {
    calls.rest.push({ path, method: init.method || 'GET' })
    return { ok: state.dbOk, json: async () => state.rows }
  },
}))

const { default: handler } = await import('../api/_routes/insights/staff-roster.js')

function call({ method = 'GET', auth = `Bearer ${KEY}` } = {}) {
  const out = {}
  const res = { status(c) { out.status = c; return res }, json(b) { out.body = b; return res }, setHeader() {} }
  const req = { method, headers: auth === null ? {} : { authorization: auth }, url: '/api/insights/staff-roster' }
  return handler(req, res).then(() => out)
}

beforeEach(() => {
  state.slug = 'movebetter'; state.rows = [{ name: 'Dr. Q', legal_name: 'Michael Quasney', user_id: 'secret' }, { name: 'Zach Cullen', legal_name: null }]; state.dbOk = true
  calls.rest = []
  process.env.WEEKLY_MARKETING_KEY = KEY
})

describe('staff roster read', () => {
  it('returns active staff names only, scoped to the workspace', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.body.active_staff).toEqual([{ name: 'Dr. Q', legal_name: 'Michael Quasney' }, { name: 'Zach Cullen', legal_name: null }])
    expect(calls.rest).toHaveLength(1)
    expect(calls.rest[0].path).toContain('workspace_id=eq.w1')
    expect(calls.rest[0].path).toContain('deactivated_at=is.null')
    expect(calls.rest[0].path).toContain('archived_at=is.null')
  })

  it('refuses a missing or wrong key and reads nothing', async () => {
    for (const auth of [null, `Bearer ${KEY}x`, KEY]) {
      const r = await call({ auth })
      expect(r.status).toBe(401)
    }
    expect(calls.rest).toHaveLength(0)
  })

  it('answers 404 outside the allowlist and with no workspace', async () => {
    state.slug = 'someoneelse'
    expect((await call()).status).toBe(404)
    state.slug = null
    expect((await call()).status).toBe(404)
    expect(calls.rest).toHaveLength(0)
  })

  it('is GET only and says so when the read fails', async () => {
    expect((await call({ method: 'POST' })).status).toBe(405)
    state.dbOk = false
    const r = await call()
    expect(r.status).toBe(502)
    expect(r.body).toEqual({ error: 'db_read_failed' })
  })
})
