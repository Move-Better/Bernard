// A Google Business post fans out to one bundle.social post per location, but
// only the first post id lands in content_items.platform_post_id. The webhook
// matched on that column alone, so every other location's outcome was dropped
// as "unmatched": a second clinic's failed post never surfaced (audit
// 2026-11-18 P2, approved by Q 2026-11-19).
//
// Now the webhook also finds the row through dispatch_state, records each
// location's outcome there, and an ERROR'd location counts as not posted, so
// the next retry posts it again instead of skipping it and calling the post done.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('bundlesocial', () => ({
  Bundlesocial: class {
    constructor() { this.webhooks = { constructEvent: (body) => JSON.parse(body) } }
  },
}))
vi.mock('@vercel/functions', () => ({ waitUntil: () => {} }))
vi.mock('../../api/_lib/notifyPublishFailure.js', () => ({ notifyPublishFailure: vi.fn(async () => {}) }))
vi.mock('../../api/_lib/agentActions.js', () => ({ recordAgentAction: vi.fn(async () => {}) }))

process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_KEY = 'test-only-invalid'
process.env.BUNDLE_WEBHOOK_SECRET = 'test-only-invalid'
process.env.BUNDLE_API_KEY = 'test-only-invalid'

const handler = (await import('../../api/_routes/webhooks/bundle.js')).default
const { unpostedTargets, mergePostedLocations, isChannelComplete } = await import('../../api/_lib/autoPublishRetry.js')

const LOC_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const LOC_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const LOC_C = 'cccccccc-0000-4000-8000-000000000003'

// One content_items row, held in memory; fetch below plays PostgREST over it.
let row
// When set, the first conditional dispatch_state write finds the column changed
// (another writer got there first) and this state is what a re-read returns.
let concurrentState

function freshRow() {
  return {
    id: 'dddddddd-0000-4000-8000-000000000004',
    workspace_id: 'eeeeeeee-0000-4000-8000-000000000005',
    status: 'scheduled', platform: 'gbp', topic: 'Knees', content: 'hello', resolved_url: null,
    platform_post_id: 'post_a',
    created_at: new Date().toISOString(),
    dispatch_state: { published_channels: { gbp: { content_item_id: 'x', locations: {
      [LOC_A]: { post_id: 'post_a', fired_at: 't1' },
      [LOC_B]: { post_id: 'post_b', fired_at: 't2' },
    } } } },
  }
}

const json = (v, status = 200) => new Response(JSON.stringify(v), { status })

function fakeSupabase(url, init = {}) {
  const u = new URL(url)
  const q = u.searchParams
  const method = init.method || 'GET'
  if (method === 'GET') {
    if (q.get('platform_post_id')) return json(q.get('platform_post_id') === `eq.${row.platform_post_id}` ? [row] : [])
    if (q.get('platform') === 'eq.gbp') return json([row])
    if (q.get('select') === 'dispatch_state') return json([{ dispatch_state: row.dispatch_state }])
    return json([])
  }
  // PATCH
  const body = JSON.parse(init.body)
  const cond = q.get('dispatch_state')
  if (cond) {
    if (concurrentState) {
      row.dispatch_state = concurrentState
      concurrentState = null
    }
    const expected = JSON.parse(cond.slice('eq.'.length))
    if (JSON.stringify(expected) !== JSON.stringify(row.dispatch_state)) return json([])
    Object.assign(row, body)
    return json([row])
  }
  const statusGuard = q.get('status')
  if (statusGuard === 'eq.scheduled' && row.status !== 'scheduled') return json([])
  if (statusGuard === 'neq.failed' && row.status === 'failed') return json([])
  Object.assign(row, body)
  return json([row])
}

function mockRes() {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

async function deliver(data) {
  const raw = JSON.stringify({ type: 'post.published', data })
  const res = mockRes()
  await handler({ method: 'POST', headers: { 'x-signature': 'sig' }, rawBody: Buffer.from(raw) }, res)
  return res
}

const locations = () => row.dispatch_state.published_channels.gbp.locations

beforeEach(() => {
  row = freshRow()
  concurrentState = null
  vi.stubGlobal('fetch', vi.fn(fakeSupabase))
})
afterEach(() => vi.unstubAllGlobals())

describe('bundle webhook — every GBP location reports back', () => {
  it('an ERROR on the second location finds the row, fails it, and marks that location for a retry', async () => {
    const res = await deliver({ id: 'post_b', status: 'ERROR', error: 'Location suspended' })
    expect(res.body.unmatched).toBeUndefined()
    expect(res.body).toMatchObject({ status: 'ERROR', failed: true })
    expect(row.status).toBe('failed')
    expect(locations()[LOC_B]).toMatchObject({ post_id: 'post_b', status: 'error', error: 'Location suspended' })
    expect(locations()[LOC_A].status).toBeUndefined()
    // The retry now posts Clinic B again and leaves Clinic A alone.
    const targets = [{ id: LOC_A }, { id: LOC_B }]
    expect(unpostedTargets(targets, row.dispatch_state.published_channels.gbp).map((t) => t.id)).toEqual([LOC_B])
  })

  it('a POSTED on the second location records it as posted', async () => {
    const res = await deliver({ id: 'post_b', status: 'POSTED' })
    expect(res.body.unmatched).toBeUndefined()
    expect(locations()[LOC_B].status).toBe('posted')
  })

  it('an ERROR on the first location (matched by platform_post_id) is recorded too', async () => {
    await deliver({ id: 'post_a', status: 'ERROR', error: 'nope' })
    expect(locations()[LOC_A].status).toBe('error')
  })

  it('a post id no row knows is still acked as unmatched', async () => {
    const res = await deliver({ id: 'post_zzz', status: 'POSTED' })
    expect(res.body.unmatched).toBe(true)
  })

  it('never overwrites a location another writer added since the read', async () => {
    const theirs = JSON.parse(JSON.stringify(row.dispatch_state))
    theirs.published_channels.gbp.locations[LOC_C] = { post_id: 'post_c', fired_at: 't3' }
    concurrentState = theirs
    await deliver({ id: 'post_b', status: 'ERROR', error: 'boom' })
    expect(locations()[LOC_C]).toMatchObject({ post_id: 'post_c' })
    expect(locations()[LOC_B].status).toBe('error')
  })
})

describe('an ERROR location is not posted', () => {
  const errored = { locations: { [LOC_A]: { post_id: 'post_a' }, [LOC_B]: { post_id: 'post_b', status: 'error' } }, content_item_id: 'x' }

  it('the retry post replaces the errored record, and only that one', () => {
    const next = mergePostedLocations(errored, [{ id: LOC_A, postId: 'dup' }, { id: LOC_B, postId: 'post_b2' }], 'now')
    expect(next.locations[LOC_A].post_id).toBe('post_a')
    expect(next.locations[LOC_B]).toEqual({ post_id: 'post_b2', fired_at: 'now' })
  })

  it('the channel is not complete while a location is errored', () => {
    expect(isChannelComplete([{ id: LOC_A }, { id: LOC_B }], errored)).toBe(false)
  })
})
