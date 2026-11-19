// A location or campaign id written onto a tenant row must belong to the same
// workspace. The interview POST checked this, but the interview PATCH and the
// campaigns upsert only checked the UUID shape, so a member of workspace A
// could attach workspace B's location or campaign (the campaign name then
// leaked back through the staff embed). Audit 2026-11-18, full, P2.
//
// The handlers are driven for real; fetch is a fake PostgREST that knows one
// interview owned by the caller and treats every location/campaign as foreign
// unless the test says otherwise.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceContext: async () => ({ id: 'ws-a', slug: 'a', clerk_org_id: 'org_a' }),
}))
vi.mock('../../api/_lib/auth.js', () => ({
  requireRole: async () => ({ ok: true, userId: 'user_1', role: 'admin', isOrgAdmin: true }),
  requireCapability: async () => ({ ok: true }),
}))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))

const { default: interviews } = await import('../../api/_routes/db/interviews.js')
const { default: upsert } = await import('../../api/_routes/campaigns/upsert.js')

const IV = '11111111-1111-4111-8111-111111111111'
const FOREIGN = '22222222-2222-4222-8222-222222222222'
const OWN = '33333333-3333-4333-8333-333333333333'

let writes
function json(body) { return new Response(JSON.stringify(body), { status: 200 }) }

function fakeFetch(url, init = {}) {
  const u = new URL(String(url), 'http://test.local')
  const table = u.pathname.split('/').pop()
  const method = init.method || 'GET'
  if (method !== 'GET') { writes.push(`${method} ${table}`); return Promise.resolve(json([{ id: IV }])) }
  const id = (u.searchParams.get('id') || '').replace(/^eq\./, '')
  const scoped = u.searchParams.get('workspace_id') === 'eq.ws-a'
  if (table === 'interviews') return Promise.resolve(json([{ owner_id: 'user_1', staff_id: null }]))
  if (table === 'workspace_locations' || table === 'campaigns') {
    return Promise.resolve(json(scoped && id === OWN ? [{ id }] : []))
  }
  return Promise.resolve(json([]))
}

function res() {
  const r = { statusCode: 0, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.setHeader = () => r
  return r
}

function patchInterview(body) {
  const r = res()
  return interviews({ method: 'PATCH', url: `/api/db/interviews?id=${IV}`, headers: {}, body }, r).then(() => r)
}

function upsertCampaign(body) {
  const r = res()
  return upsert({ method: 'POST', headers: {}, body: { name: 'Spring', ...body } }, r).then(() => r)
}

describe('workspace-scoped reference ids', () => {
  beforeEach(() => {
    writes = []
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    for (const m of ['error', 'info', 'warn']) vi.spyOn(console, m).mockImplementation(() => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('interview PATCH rejects another workspace\'s location', async () => {
    const r = await patchInterview({ locationId: FOREIGN })
    expect(r.statusCode).toBe(404)
    expect(writes).toEqual([])
  })

  it('interview PATCH rejects another workspace\'s campaign', async () => {
    const r = await patchInterview({ campaignId: FOREIGN })
    expect(r.statusCode).toBe(422)
    expect(writes).toEqual([])
  })

  it('interview PATCH accepts this workspace\'s location and campaign, and clearing', async () => {
    expect((await patchInterview({ locationId: OWN, campaignId: OWN })).statusCode).toBe(200)
    expect((await patchInterview({ locationId: null, campaignId: null })).statusCode).toBe(200)
  })

  it('campaign upsert rejects another workspace\'s target location', async () => {
    const r = await upsertCampaign({ target_location_id: FOREIGN })
    expect(r.statusCode).toBe(400)
    expect(writes).toEqual([])
  })

  it('campaign upsert accepts this workspace\'s target location', async () => {
    const r = await upsertCampaign({ target_location_id: OWN })
    expect(r.statusCode).toBeLessThan(300)
  })
})
