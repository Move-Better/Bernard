import { describe, it, expect, vi, beforeEach } from 'vitest'

// Guards the brief "Schedule" dispatch against the silent-no-op bug (audit
// 2026-08-08 P0).
//
// dispatchBrief used to create the content_items row with
// `status: scheduledAt ? 'scheduled' : 'draft'` BEFORE calling the publish
// endpoint. The publish route's cross-path double-publish guard
// (api/_routes/publish/social.js) treats a stored 'scheduled'/'published'
// status as "another path already dispatched this piece" and returns
// {success, alreadyDispatched: true} WITHOUT calling bundle.social — so a
// scheduled brief dispatch reported success while posting nothing. The row
// must be born 'draft'; the publish route's claim-and-commit
// (dispatchCommitFields) is the only writer of the terminal status.

const apiFetch = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: (...a) => apiFetch(...a) }))

const { dispatchBrief } = await import('@/lib/publish')

const BRIEF = { id: 'brief-1', target_platform: 'instagram' }
const ASSET = { blob_url: 'https://blob/final.mp4', kind: 'video' }

function mockCalls() {
  apiFetch.mockImplementation((path) => {
    if (path === '/api/db/content') return Promise.resolve([{ id: 'item-1' }])
    if (path === '/api/publish/social') {
      return Promise.resolve({ success: true, committedStatus: 'scheduled' })
    }
    return Promise.resolve({})
  })
}

function creationBody() {
  const call = apiFetch.mock.calls.find(([path]) => path === '/api/db/content')
  expect(call, 'dispatchBrief must create the content_items row').toBeTruthy()
  return JSON.parse(call[1].body)[0]
}

function publishBody() {
  const call = apiFetch.mock.calls.find(([path]) => path === '/api/publish/social')
  expect(call, 'dispatchBrief must call the publish endpoint').toBeTruthy()
  return JSON.parse(call[1].body)
}

beforeEach(() => {
  apiFetch.mockReset()
  mockCalls()
})

describe('dispatchBrief creates the row at draft, never pre-scheduled', () => {
  it('a scheduled dispatch is born draft so the publish claim actually posts', async () => {
    await dispatchBrief({
      brief: BRIEF,
      asset: ASSET,
      composedContent: 'A real caption',
      scheduledAt: '2026-08-15T17:00:00.000Z',
      userId: 'user-1',
    })
    const body = creationBody()
    // Born 'scheduled' ⇒ the publish route's alreadyDispatched branch fires and
    // bundle.social is never called. 'draft' is the only safe birth status.
    expect(body.status).toBe('draft')
    // The intended time still rides along for visibility while the dispatch is
    // in flight; the server's dispatchCommitFields overwrites it on success.
    expect(body.scheduled_at).toBe('2026-08-15T17:00:00.000Z')
    // And the publish call carries the row id + schedule so the server can
    // claim, post, and commit the terminal status itself.
    const pub = publishBody()
    expect(pub.contentItemId).toBe('item-1')
    expect(pub.scheduledAt).toBe('2026-08-15T17:00:00.000Z')
  })

  it('a post-now dispatch is also born draft', async () => {
    await dispatchBrief({
      brief: BRIEF,
      asset: ASSET,
      composedContent: 'A real caption',
      scheduledAt: null,
      userId: 'user-1',
    })
    expect(creationBody().status).toBe('draft')
  })
})
