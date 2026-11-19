// A multi-location Google Business post that failed part-way through used to
// re-post to the locations that had already succeeded when someone pressed
// Publish again or used the producer retry: runBundlePublish kept no record of
// which locations posted, and its catch threw the successful posts away. Those
// duplicates are public on the clinic's listings (audit 2026-11-18, item 10).
//
// Now every posted location is recorded in content_items.dispatch_state (the
// same posted-set /week's Approve keeps, migration 157) and skipped on retry.
//
// Also pinned here: GBP takes at most one image (bundle.social limits table,
// "0-1 image only (no video)"), and the editor's Publish path and /week's
// Approve path now send the same single image via gbpMedia (audit item 9).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const LOC_A = { id: 'aaaaaaaa-0000-4000-8000-000000000001', label: 'Clinic A', teamId: 'team_a' }
const LOC_B = { id: 'bbbbbbbb-0000-4000-8000-000000000002', label: 'Clinic B', teamId: 'team_b' }
const PIECE_ID = 'cccccccc-0000-4000-8000-000000000003'
const WS = { id: 'dddddddd-0000-4000-8000-000000000004', slug: 'test', clerk_org_id: 'org_x', bundle_team_id: 'team_brand' }

// Every publish() call the fake BundlePublisher sees, and which teams fail.
const calls = []
let failingTeams = new Set()
// The dispatch_state the code last persisted (what the DB row would hold).
let recordedState = null
let claimRow = null
// Whether the posted-set save succeeds (a non-2xx makes recordDispatchState return false).
let recordOk = true
const deleted = []

vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

vi.mock('../../api/_lib/social/index.js', () => ({
  BundlePublisher: class {
    constructor(_ws, opts = {}) { this.teamId = opts.teamId || 'team_brand' }
    async deletePost(args) { deleted.push(args); return {} }
    async publish(args) {
      calls.push({ teamId: this.teamId, ...args })
      if (failingTeams.has(this.teamId)) throw new Error(`bundle 500 for ${this.teamId}`)
      return { success: true, postId: `post_${this.teamId}_${calls.length}`, scheduledAt: '2026-11-19T18:00:00.000Z', status: 'SCHEDULED' }
    }
  },
}))

vi.mock('../../api/_lib/social/gbpTargets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveBundleGbpTargets: vi.fn(async () => [LOC_A, LOC_B]),
}))

vi.mock('../../api/_lib/dispatchClaim.js', () => ({
  claimDispatch: vi.fn(async () => ({ ok: true, row: claimRow })),
  releaseDispatch: vi.fn(async () => {}),
  recordDispatchState: vi.fn(async (_id, _ws, state) => {
    if (!recordOk) return false
    recordedState = JSON.parse(JSON.stringify(state))
    return true
  }),
}))

vi.mock('../../api/_lib/wordsApprovalGate.js', () => ({ checkWordsApproved: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../api/_lib/atomSchedule.js', () => ({ syncAtomSchedule: vi.fn(async () => {}) }))
vi.mock('../../api/_lib/workspaceContext.js', () => ({ workspaceContext: vi.fn(async () => WS) }))
vi.mock('../../api/_lib/workspaceScope.js', () => ({ workspaceScope: vi.fn(async () => ({ workspace: WS })) }))
vi.mock('../../api/_lib/auth.js', () => ({ requireRole: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: vi.fn(async () => true) }))
vi.mock('../../api/_lib/agentActions.js', () => ({ recordAgentAction: vi.fn(async () => {}) }))
vi.mock('../../api/_lib/notifyPublishFailure.js', () => ({ notifyPublishFailure: vi.fn(async () => {}) }))
vi.mock('../../api/_lib/sentry.js', () => ({ withSentry: (h) => h }))

// social.js / retry-publish.js read these at module load, so set them first.
process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_KEY = 'test-only-invalid'

const { runBundlePublish } = await import('../../api/_routes/publish/social.js')
const socialHandler = (await import('../../api/_routes/publish/social.js')).default
const retryHandler = (await import('../../api/_routes/producer/retry-publish.js')).default
const { dispatchContentItem } = await import('../../api/_lib/dispatchContentItem.js')
const { gbpMedia } = await import('../../api/_lib/social/gbpTargets.js')

const PHOTO = (i) => ({ url: `https://x/${i}.jpg`, type: 'image', kind: 'image' })
const VIDEO = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }

function mockRes() {
  const res = { statusCode: 0, body: null }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}

const teamsPosted = () => calls.map((c) => c.teamId)

beforeEach(() => {
  calls.length = 0
  failingTeams = new Set()
  recordedState = null
  claimRow = null
  recordOk = true
  deleted.length = 0
  process.env.SUPABASE_URL = 'https://sb.test'
  process.env.SUPABASE_SERVICE_KEY = 'test-only-invalid'
})

describe('runBundlePublish — a GBP fan-out that fails part-way', () => {
  it('records the location that posted, reports the one that failed, and a retry posts only the failed one', async () => {
    failingTeams = new Set(['team_b'])
    const first = await runBundlePublish(WS, {
      platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)],
      dispatch: { pieceId: PIECE_ID, state: {} },
    })
    expect(teamsPosted()).toEqual(['team_a', 'team_b'])
    expect(first.status).toBe(502)
    expect(first.body).toMatchObject({ error: 'bundle_gbp_partial_failure', partial: true, postedCount: 1 })
    expect(first.body.failedLocations).toEqual([{ id: LOC_B.id, label: 'Clinic B' }])
    expect(Object.keys(recordedState.published_channels.gbp.locations)).toEqual([LOC_A.id])
    const postA = recordedState.published_channels.gbp.locations[LOC_A.id].post_id

    // Retry with the state the row now holds; Clinic B is back up.
    calls.length = 0
    failingTeams = new Set()
    const retry = await runBundlePublish(WS, {
      platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)],
      dispatch: { pieceId: PIECE_ID, state: recordedState },
    })
    expect(teamsPosted()).toEqual(['team_b'])
    expect(retry.status).toBe(200)
    expect(retry.body.success).toBe(true)
    expect(retry.body.profileCount).toBe(2)
    // The row keeps the first location's post id, from the earlier attempt.
    expect(retry.body.postId).toBe(postA)
    expect(Object.keys(recordedState.published_channels.gbp.locations).sort()).toEqual([LOC_A.id, LOC_B.id].sort())
  })

  it('still posts to the later locations when an earlier one fails', async () => {
    failingTeams = new Set(['team_a'])
    const r = await runBundlePublish(WS, {
      platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)],
      dispatch: { pieceId: PIECE_ID, state: {} },
    })
    expect(teamsPosted()).toEqual(['team_a', 'team_b'])
    expect(r.body.failedLocations).toEqual([{ id: LOC_A.id, label: 'Clinic A' }])
    expect(Object.keys(recordedState.published_channels.gbp.locations)).toEqual([LOC_B.id])
  })

  it('reports a plain failure when no location posted', async () => {
    failingTeams = new Set(['team_a', 'team_b'])
    const r = await runBundlePublish(WS, {
      platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)],
      dispatch: { pieceId: PIECE_ID, state: {} },
    })
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ error: 'bundle_gbp_post_failed', partial: false, postedCount: 0 })
  })
})

describe('the editor Publish route passes the claimed posted-set into the fan-out', () => {
  it('a second Publish after a partial failure posts only to the failed location', async () => {
    claimRow = {
      id: PIECE_ID, status: 'approved',
      dispatch_state: { published_channels: { gbp: { content_item_id: PIECE_ID, locations: { [LOC_A.id]: { post_id: 'post_a_old', fired_at: 'x' } } } } },
    }
    const res = mockRes()
    await socialHandler({ method: 'POST', headers: {}, body: { platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)], contentItemId: PIECE_ID } }, res)
    expect(teamsPosted()).toEqual(['team_b'])
    expect(res.statusCode).toBe(200)
    expect(res.body.postId).toBe('post_a_old')
  })
})

describe('the producer retry passes the claimed posted-set into the fan-out', () => {
  it('a retry after a partial failure posts only to the failed location', async () => {
    const item = { id: PIECE_ID, platform: 'gbp', content: 'hello', media_urls: [PHOTO(0)], status: 'failed', scheduled_at: null }
    claimRow = {
      ...item,
      dispatch_state: { published_channels: { gbp: { content_item_id: PIECE_ID, locations: { [LOC_A.id]: { post_id: 'post_a_old', fired_at: 'x' } } } } },
    }
    const patches = []
    const fetchMock = vi.fn(async (url, init = {}) => {
      if (init.method === 'PATCH') { patches.push(JSON.parse(init.body)); return new Response(null, { status: 204 }) }
      return new Response(JSON.stringify([item]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const res = mockRes()
      await retryHandler({ method: 'POST', headers: {}, body: { contentItemId: PIECE_ID } }, res)
      expect(teamsPosted()).toEqual(['team_b'])
      expect(res.statusCode).toBe(200)
      expect(patches.at(-1)).toMatchObject({ status: 'scheduled', platform_post_id: 'post_a_old' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('gbpMedia — one image per Google Business post, on both dispatch paths', () => {
  it('keeps only the first image, and prefers an image over a video', () => {
    expect(gbpMedia([PHOTO(0), PHOTO(1), PHOTO(2)])).toEqual([PHOTO(0)])
    expect(gbpMedia([VIDEO, PHOTO(1)])).toEqual([PHOTO(1)])
    expect(gbpMedia([])).toEqual([])
    expect(gbpMedia(undefined)).toEqual([])
  })

  it('the editor Publish path (runBundlePublish) sends one image per location', async () => {
    await runBundlePublish(WS, { platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0), PHOTO(1), PHOTO(2)] })
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c.mediaUrls).toEqual([PHOTO(0)])
  })

  it('the /week Approve path (dispatchContentItem) sends one image per location', async () => {
    const piece = { id: PIECE_ID, status: 'approved', platform: 'gbp', content: 'hello', media_urls: [PHOTO(0), PHOTO(1), PHOTO(2)], scheduled_at: null }
    claimRow = { ...piece, dispatch_state: {} }
    const r = await dispatchContentItem({ ws: WS, piece })
    expect(r.dispatched).toBe(true)
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(c.mediaUrls).toEqual([PHOTO(0)])
  })

  it('the /week Approve path still sends every image to a non-GBP platform', async () => {
    const piece = { id: PIECE_ID, status: 'approved', platform: 'linkedin', content: 'hello', media_urls: [PHOTO(0), PHOTO(1)], scheduled_at: null }
    claimRow = { ...piece, dispatch_state: {} }
    await dispatchContentItem({ ws: WS, piece })
    expect(calls).toHaveLength(1)
    expect(calls[0].mediaUrls).toEqual([PHOTO(0), PHOTO(1)])
  })
})

describe('a posted-set save that fails stops the fan-out (audit P2)', () => {
  it('runBundlePublish posts no further location once a record fails to save', async () => {
    recordOk = false
    const r = await runBundlePublish(WS, {
      platform: 'gbp', content: 'hello', mediaUrls: [PHOTO(0)],
      dispatch: { pieceId: PIECE_ID, state: {} },
    })
    expect(teamsPosted()).toEqual(['team_a'])
    expect(r.status).toBe(502)
    expect(r.body.failedLocations).toEqual([{ id: LOC_B.id, label: 'Clinic B' }])
  })

  it('dispatchContentItem posts no further location once a record fails to save', async () => {
    recordOk = false
    const piece = { id: PIECE_ID, status: 'approved', platform: 'gbp', content: 'hello', media_urls: [PHOTO(0)], scheduled_at: null }
    claimRow = { ...piece, dispatch_state: {} }
    const r = await dispatchContentItem({ ws: WS, piece })
    expect(teamsPosted()).toEqual(['team_a'])
    expect(r.dispatched).toBe(false)
  })
})

describe('cancelling a scheduled post fails closed (audit P2)', () => {
  it('does not cancel when the ownership lookup errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    try {
      const res = mockRes()
      await socialHandler({ method: 'DELETE', headers: {}, body: { platformPostId: 'post_x' } }, res)
      expect(res.statusCode).toBe(503)
      expect(deleted).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('cancels when the lookup finds the post in this workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: PIECE_ID }]), { status: 200 })))
    try {
      const res = mockRes()
      await socialHandler({ method: 'DELETE', headers: {}, body: { platformPostId: 'post_x' } }, res)
      expect(res.statusCode).toBe(200)
      expect(deleted).toEqual([{ postId: 'post_x' }])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
