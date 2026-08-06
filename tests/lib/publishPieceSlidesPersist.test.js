import { describe, it, expect, vi, beforeEach } from 'vitest'

// Guards the ONE legal window for persisting freshly-baked carousel slides.
//
// 'slides' is a FROZEN_PATCH_FIELD (src/lib/publishLock.js). The publish route
// commits the row to 'scheduled' server-side in the same sb-direct write that
// releases the dispatch claim (dispatchCommitFields), bypassing the publish lock.
// So the only status at which a client may still write 'slides' is BEFORE that
// dispatch, while the row is 'draft'/'approved'. The callers used to persist the
// baked slides AFTER dispatch, on the now-'scheduled' row — which the lock 409s,
// surfacing as a false "Couldn't update content — locked_scheduled" toast even
// though the post shipped (the #2553 gap, feedback 2026-08-05).
//
// publishPieceToSocial now persists the slides itself, before dispatch. This pins
// that ordering: the slide PATCH must precede the publish POST, and NO frozen-
// field PATCH may follow it. A mutation (moving the persist after the dispatch)
// reddens the second test.

const apiFetch = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: (...a) => apiFetch(...a) }))

// The canvas bake is mocked — the invariant under test is WHEN the baked slides
// are persisted relative to dispatch, not how they are rendered.
const ensureRenderedSlides = vi.fn()
vi.mock('@/lib/renderSlides', () => ({
  ensureRenderedSlides: (...a) => ensureRenderedSlides(...a),
}))

const { publishPieceToSocial } = await import('@/lib/publishPiece')
const { FROZEN_PATCH_FIELDS } = await import('@/lib/publishLock')

const PUBLISH_RESPONSE = {
  success: true,
  postId: 'bundle-post-123',
  scheduledAt: '2026-08-01T17:00:00.000Z',
  status: 'SCHEDULED',
}

const BAKED = [{ url: 'https://blob/baked-1.jpg', kind: 'photo' }]

// A fresh, not-yet-baked piece: non-empty slides so the bake path runs, a photo
// (not a video) so it isn't treated as a Reel and skipped.
const PIECE = {
  id: 'a3f1c2d4-0000-4000-8000-000000000001',
  platform: 'instagram',
  content: 'hi',
  media_urls: [{ url: 'https://blob/raw.jpg', type: 'photo' }],
  slides: [{ blocks: [] }],
  aspect_ratio: '4:5',
}
const OPTS = { userEmail: 'someone@movebetter.co', workspace: {}, themes: [] }

const isContentPatch = ([p, o]) => p.startsWith('/api/db/content') && o?.method === 'PATCH'
const isPublishPost = ([p, o]) => p.startsWith('/api/publish/') && o?.method === 'POST'

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((path) =>
    Promise.resolve(path.startsWith('/api/publish/') ? PUBLISH_RESPONSE : {}),
  )
  ensureRenderedSlides.mockReset()
  ensureRenderedSlides.mockResolvedValue({
    slides: BAKED,
    publishMediaUrls: ['https://blob/baked-1.jpg'],
    changed: true,
  })
})

describe('publishPieceToSocial — baked slides persist BEFORE dispatch (pre-lock)', () => {
  it('PATCHes the baked slides to the content route before the publish dispatch', async () => {
    await publishPieceToSocial(PIECE, OPTS)

    const calls = apiFetch.mock.calls
    const patchIdx = calls.findIndex(isContentPatch)
    const postIdx = calls.findIndex(isPublishPost)

    // Non-vacuity: both writes must actually have fired, or the ordering
    // assertion below could pass on an empty mock.
    expect(patchIdx, 'a content-route PATCH must fire').toBeGreaterThanOrEqual(0)
    expect(postIdx, 'the publish dispatch must fire').toBeGreaterThanOrEqual(0)
    expect(patchIdx, 'slides must be persisted BEFORE dispatch').toBeLessThan(postIdx)

    const body = JSON.parse(calls[patchIdx][1].body)
    expect(body).toHaveProperty('slides')
    expect(body.slides).toEqual(BAKED)
  })

  it('makes NO frozen-field PATCH after the dispatch (the locked_scheduled guard)', async () => {
    await publishPieceToSocial(PIECE, OPTS)

    const calls = apiFetch.mock.calls
    const postIdx = calls.findIndex(isPublishPost)
    expect(postIdx, 'the publish dispatch must fire').toBeGreaterThanOrEqual(0)

    const frozenAfterDispatch = calls.slice(postIdx + 1).find(([p, o]) => {
      if (!isContentPatch([p, o])) return false
      const body = JSON.parse(o.body || '{}')
      return FROZEN_PATCH_FIELDS.some((k) => body[k] !== undefined)
    })
    expect(
      frozenAfterDispatch,
      'no frozen-field PATCH may follow dispatch — it 409s on the now-scheduled row',
    ).toBeUndefined()
  })

  it('no longer returns renderedSlides, so a caller cannot re-persist past the lock', async () => {
    const out = await publishPieceToSocial(PIECE, OPTS)
    expect(out).not.toHaveProperty('renderedSlides')
  })

  it('skips the persist entirely when the bake did not change the slides', async () => {
    ensureRenderedSlides.mockResolvedValue({
      slides: PIECE.slides,
      publishMediaUrls: [],
      changed: false,
    })
    await publishPieceToSocial(PIECE, OPTS)
    expect(apiFetch.mock.calls.some(isContentPatch)).toBe(false)
    // The dispatch still runs.
    expect(apiFetch.mock.calls.some(isPublishPost)).toBe(true)
  })
})
