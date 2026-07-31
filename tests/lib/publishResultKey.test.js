import { describe, it, expect, vi, beforeEach } from 'vitest'

// Guards the seam that the Buffer-name retirement (this PR) broke once already:
// publishItem() writes the per-transport response under ONE key on its results
// object, and three call sites in two files read it back by that same key.
//
// Every read is optional-chained (`result?.social?.…`), so a key mismatch does
// not throw — it yields undefined, the row silently loses its post id / queue
// slot, and lint, typecheck, build and the whole suite stay green. Renaming the
// key in publish.js without renaming it in publishPiece.js did exactly that.
//
// So this asserts the round trip through the real functions rather than the
// spelling of the key: whatever publishItem writes must be what the readers
// read. Rename it freely — just rename it everywhere, or this goes red.

const apiFetch = vi.fn()
vi.mock('@/lib/api', () => ({ apiFetch: (...a) => apiFetch(...a) }))

const { publishItem, publishAndTrack } = await import('@/lib/publish')
const { publishPieceToSocial } = await import('@/lib/publishPiece')

// A publish-endpoint response shaped like api/_routes/publish/social.js's.
const PUBLISH_RESPONSE = {
  success: true,
  postId: 'bundle-post-123',
  scheduledAt: '2026-08-01T17:00:00.000Z',
  status: 'SCHEDULED',
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockImplementation((path) =>
    Promise.resolve(path.startsWith('/api/publish/') ? PUBLISH_RESPONSE : {}),
  )
})

const ITEM = { id: 'a3f1c2d4-0000-4000-8000-000000000001', platform: 'instagram', content: 'hi', mediaUrls: [] }

describe('publishItem — the results key the readers depend on', () => {
  it('exposes the publish response under exactly one key, carrying the post id', async () => {
    const results = await publishItem(ITEM, {})
    const keys = Object.keys(results)
    expect(keys).toHaveLength(1)
    // The readers below destructure this key; the round-trip test is what
    // actually enforces the match, this just pins the shape.
    expect(results[keys[0]]).toMatchObject({ postId: 'bundle-post-123' })
  })

  it('routes social platforms to the publish endpoint', async () => {
    await publishItem(ITEM, {})
    expect(apiFetch).toHaveBeenCalledWith('/api/publish/social', expect.objectContaining({ method: 'POST' }))
  })
})

describe('publishAndTrack — reads back what publishItem wrote', () => {
  it('persists the post id onto the row instead of undefined', async () => {
    await publishAndTrack(ITEM, 'someone@movebetter.co')

    const patch = apiFetch.mock.calls.find(([p, o]) => p.startsWith('/api/db/content') && o?.method === 'PATCH')
    expect(patch, 'expected a PATCH to /api/db/content').toBeTruthy()
    const body = JSON.parse(patch[1].body)

    // The regression: a key mismatch makes this undefined, so the published row
    // keeps a null post id and nothing downstream can find it. Before migration
    // 202 this asserted on bufferUpdateId too — the two columns held the same
    // value, and platform_post_id is the one that survived.
    expect(body.platformPostId).toBe('bundle-post-123')
    expect(body.bufferUpdateId).toBeUndefined()
  })

  it('echoes the provider-assigned slot back in queue mode', async () => {
    await publishAndTrack({ ...ITEM, useQueue: true }, 'someone@movebetter.co')

    const patch = apiFetch.mock.calls.find(([p, o]) => p.startsWith('/api/db/content') && o?.method === 'PATCH')
    const body = JSON.parse(patch[1].body)
    expect(body.scheduledAt).toBe(PUBLISH_RESPONSE.scheduledAt)
  })
})

// publishPiece.js is a SECOND file reading the same results key, and it is the
// one the rename actually broke. The block above passes with it broken, so this
// block is the part that guards the real regression — a mutation test proved
// the difference rather than assumed it. No slides on the piece, so the
// carousel bake short-circuits and only the publish seam is exercised.
describe('publishPieceToSocial — the second reader of the same key', () => {
  const PIECE = { id: ITEM.id, platform: 'instagram', content: 'hi', media_urls: [], slides: [] }
  const OPTS = { userEmail: 'someone@movebetter.co', workspace: {}, themes: [] }

  it('surfaces the provider-assigned queue slot rather than silently null', async () => {
    const out = await publishPieceToSocial(PIECE, { ...OPTS, useQueue: true })
    expect(out.scheduling).toBe(true)
    // Reading the wrong key here does not throw — it yields undefined and this
    // falls back to null, stranding the row with no scheduled_at.
    expect(out.scheduledAt).toBe(PUBLISH_RESPONSE.scheduledAt)
  })

  it('prefers an explicit slot over the provider queue slot', async () => {
    const explicit = '2026-09-09T12:00:00.000Z'
    const out = await publishPieceToSocial(PIECE, { ...OPTS, scheduledAt: explicit })
    expect(out.scheduledAt).toBe(explicit)
  })
})
