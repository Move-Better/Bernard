import { describe, it, expect, vi, beforeEach } from 'vitest'

// GUARD — saveBroll's `awaitThumbnails` contract, which is what closes the
// auto-drafted-reel poster race (#2311).
//
// The race: reelFactory renders a clip, inserts the b-roll row, then IMMEDIATELY
// snapshots that row into content_items.media_urls via createClipDraft. A
// media_urls entry carries its own thumbnailUrl and is a snapshot, not a join —
// so if the poster does not exist at snapshot time the draft is born with
// thumbnailUrl null and stays that way. The entry-sync write-back was racing an
// insert firing milliseconds later, and losing.
//
// The fix is not "generate a poster" (backgrounding it still loses the race) —
// it is specifically that with awaitThumbnails:true saveBroll AWAITS the poster
// and writes the resulting URL back ONTO THE ROW OBJECT IT RETURNS, so the
// caller's `saved[0].thumbnail_url` is populated before it builds the draft.
//
// #2311 tested the array transform (applyEntryThumbnail) but never this
// assignment, so the load-bearing half of its own fix was unpinned. Every
// assertion here is a link in that chain:
//
//   generateThumbnailFromPath returns uploaded.url
//     -> generateAndPersistThumbnail returns it through
//     -> saveBroll assigns it onto the returned row   <-- pinned here
//     -> reelFactory reads saved[0].thumbnail_url
//     -> createClipDraft writes it into the media_urls entry
//
// Drop any one and reels silently go back to poster-less with nothing failing.

const thumbCalls = []
let thumbImpl = async () => 'https://blob.example/poster.jpg'

vi.mock('../../api/_lib/thumbnail.js', () => ({
  generateAndPersistThumbnail: vi.fn(async (asset, scope) => {
    thumbCalls.push({ assetId: asset.id, scopeId: scope?.id })
    return thumbImpl(asset)
  }),
}))

const waitUntilCalls = []
vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn((p) => { waitUntilCalls.push(p); return p }),
}))

vi.mock('../../api/_lib/visualMemoryIndex.js', () => ({
  indexMediaAsset: vi.fn(async () => ({ ok: true })),
}))

const { saveBroll } = await import('../../api/_lib/saveBroll.js')

const WS = { id: '11111111-1111-4111-8111-111111111111' }

// The Supabase REST insert echoes back the rows it was given (Prefer:
// return=representation), each with a generated id — the real shape saveBroll
// reads. Nothing here depends on a live DB.
function stubInsert() {
  globalThis.fetch = vi.fn(async (_url, init) => {
    const rows = JSON.parse(init.body)
    return {
      ok: true,
      json: async () => rows.map((r, i) => ({ ...r, id: `asset-${i}` })),
      text: async () => '',
    }
  })
}

beforeEach(() => {
  thumbCalls.length = 0
  waitUntilCalls.length = 0
  thumbImpl = async () => 'https://blob.example/poster.jpg'
  stubInsert()
})

const VIDEO = [{ blobUrl: 'https://blob.example/clip.mp4', width: 1080, height: 1920, sizeBytes: 42 }]

describe('saveBroll — awaitThumbnails closes the reel poster race', () => {
  it('returns the row ALREADY carrying thumbnail_url when awaited', async () => {
    const saved = await saveBroll({ ws: WS, renders: VIDEO, notes: 'n', awaitThumbnails: true })
    // This is the exact read reelFactory performs before createClipDraft.
    expect(saved[0].thumbnail_url).toBe('https://blob.example/poster.jpg')
  })

  it('does NOT populate thumbnail_url synchronously when backgrounded (default)', async () => {
    const saved = await saveBroll({ ws: WS, renders: VIDEO, notes: 'n' })
    // Not a defect — it is why reelFactory must opt in. If this ever starts
    // passing, the await/background distinction has collapsed and the opt-in
    // has become meaningless.
    expect(saved[0].thumbnail_url).toBeUndefined()
    expect(waitUntilCalls.length).toBeGreaterThan(0)
  })

  it('scopes the generator to the workspace', async () => {
    await saveBroll({ ws: WS, renders: VIDEO, notes: 'n', awaitThumbnails: true })
    expect(thumbCalls).toEqual([{ assetId: 'asset-0', scopeId: WS.id }])
  })

  it('still returns the clip when poster generation REJECTS', async () => {
    thumbImpl = async () => { throw new Error('ffmpeg exploded') }
    const saved = await saveBroll({ ws: WS, renders: VIDEO, notes: 'n', awaitThumbnails: true })
    // Best-effort: a poster is a nicety; losing it must never cost the clip.
    expect(saved).toHaveLength(1)
    expect(saved[0].blob_url).toBe('https://blob.example/clip.mp4')
    expect(saved[0].thumbnail_url).toBeUndefined()
  })

  it('leaves thumbnail_url unset when the generator resolves null', async () => {
    thumbImpl = async () => null
    const saved = await saveBroll({ ws: WS, renders: VIDEO, notes: 'n', awaitThumbnails: true })
    // A null must not be written as a poster URL — createClipDraft's
    // `thumbnail_url || null` would mask it, but media_urls would carry a key
    // implying a poster exists.
    expect(saved[0].thumbnail_url).toBeUndefined()
  })

  it('never asks for a poster for a photo render', async () => {
    const photo = [{ blobUrl: 'https://blob.example/still.jpg', width: 1, height: 1, sizeBytes: 1 }]
    const saved = await saveBroll({ ws: WS, renders: photo, notes: 'n', awaitThumbnails: true })
    expect(saved[0].kind).toBe('photo')
    expect(thumbCalls).toEqual([])
  })

  it('populates every video in a multi-render batch, positionally', async () => {
    thumbImpl = async (asset) => `https://blob.example/${asset.id}.jpg`
    const two = [
      { blobUrl: 'https://blob.example/a.mp4', width: 1, height: 1, sizeBytes: 1 },
      { blobUrl: 'https://blob.example/b.mp4', width: 1, height: 1, sizeBytes: 1 },
    ]
    const saved = await saveBroll({ ws: WS, renders: two, notes: 'n', awaitThumbnails: true })
    // Guards the results[i] <-> videoAssets[i] index pairing: a filter/map
    // mismatch would cross-assign posters between clips, which is invisible
    // with a single render.
    expect(saved.map((r) => r.thumbnail_url)).toEqual([
      'https://blob.example/asset-0.jpg',
      'https://blob.example/asset-1.jpg',
    ])
  })

  it('writes the poster to the right row when photos and videos are mixed', async () => {
    // The write-back walks the FILTERED video list but must land on the
    // RETURNED array. Here the video is index 1 of the return value and index 0
    // of the filter, so an off-by-one or a filter/return mismatch shows up as a
    // poster on the photo (or on nothing) rather than on the clip.
    //
    // Verified by mutation, not assumed: dropping the assignment, ignoring
    // awaitThumbnails, and making videoAssets a `.map(a => ({...a}))` copy each
    // fail this. Note that copying the rows AFTER the await — `return
    // assets.map(a => ({...a}))` — is genuinely harmless and correctly still
    // passes; the danger is mutating copies, not returning them.
    const photoThenVideo = [
      { blobUrl: 'https://blob.example/still.jpg', width: 1, height: 1, sizeBytes: 1 },
      { blobUrl: 'https://blob.example/clip.mp4', width: 1, height: 1, sizeBytes: 1 },
    ]
    const saved = await saveBroll({ ws: WS, renders: photoThenVideo, notes: 'n', awaitThumbnails: true })
    expect(saved[1].kind).toBe('video')
    expect(saved[1].thumbnail_url).toBe('https://blob.example/poster.jpg')
    expect(saved[0].thumbnail_url).toBeUndefined()
  })
})
