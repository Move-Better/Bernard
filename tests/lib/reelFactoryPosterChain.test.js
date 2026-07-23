import { describe, it, expect, vi, beforeEach } from 'vitest'

// GUARD — the two links in the reel-poster chain that #2317 left unpinned.
//
// #2311 fixed the auto-drafted-reel poster race. #2317 pinned ONE of its five
// links: that saveBroll(awaitThumbnails:true) assigns the poster onto the row
// object it returns. But nothing asserted the two links on either side of it:
//
//   saveBroll assigns onto the returned row     <-- pinned by #2317
//     -> reelFactory reads saved[0].thumbnail_url and passes it to
//        createClipDraft                          <-- UNPINNED (this file)
//     -> reelFactory asks saveBroll to AWAIT in the first place
//        (awaitThumbnails: true)                   <-- UNPINNED (this file)
//
// Drop the awaitThumbnails:true opt-in and every test in
// saveBrollAwaitThumbnails.test.js still passes green — that test only proves
// saveBroll behaves correctly WHEN asked to await; it can't see whether
// reelFactory ever asks. Same for the forward: a hardcoded `thumbnailUrl: null`
// or a `newAsset?.thumbnailUrl` (camelCase) typo passes every existing test
// suite and quietly reopens the exact bug #2311 fixed, on every future
// auto-drafted reel, with nothing failing. That specific camelCase/snake_case
// drift is not hypothetical here — it is the same bug class as #2305/#2309
// (content.js reading `patch.mediaUrls` while the client sent `media_urls`).
//
// Heavy deps (render/caption/blob-upload) are mocked so this exercises
// reelFactory's OWN wiring, not the render pipeline underneath it.

const saveBrollCalls = []
let saveBrollImpl = async (opts) => [{
  id: 'clip-asset-1',
  kind: 'video',
  blob_url: opts.renders[0].blobUrl,
  thumbnail_url: opts.awaitThumbnails ? 'https://blob.example/poster.jpg' : undefined,
}]

vi.mock('../../api/_lib/saveBroll.js', () => ({
  saveBroll: vi.fn(async (opts) => {
    saveBrollCalls.push(opts)
    return saveBrollImpl(opts)
  }),
}))

const createClipDraftCalls = []
vi.mock('../../api/_lib/clipDraft.js', () => ({
  createClipDraft: vi.fn(async (opts) => {
    createClipDraftCalls.push(opts)
    return 'draft-1'
  }),
}))

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async () => ({ url: 'https://blob.example/rendered-clip.mp4' })),
}))

vi.mock('../../api/_lib/brandRenderVideo.js', () => ({
  renderVideoChannel: vi.fn(async () => ({ buffer: Buffer.from('fake-mp4'), width: 1080, height: 1920 })),
}))

vi.mock('../../api/_lib/captionGen.js', () => ({
  generateCaption: vi.fn(async () => 'A voice-faithful caption.'),
}))

const { renderSegmentToReel } = await import('../../api/_lib/reelFactory.js')

const WS = { id: '11111111-1111-4111-8111-111111111111' }
const SEG = { id: 'seg-1', start_sec: 0, end_sec: 20, hook: 'hook text', staff_id: null, transcript_excerpt: '' }
const ASSET = { id: 'source-asset-1', blob_url: 'https://blob.example/source.mp4', filename: 'source.mp4' }

beforeEach(() => {
  saveBrollCalls.length = 0
  createClipDraftCalls.length = 0
  saveBrollImpl = async (opts) => [{
    id: 'clip-asset-1',
    kind: 'video',
    blob_url: opts.renders[0].blobUrl,
    thumbnail_url: opts.awaitThumbnails ? 'https://blob.example/poster.jpg' : undefined,
  }]
  // The trailing video_segments status PATCH (reelFactory's internal sb()) is
  // best-effort and .catch()-swallowed by the caller either way — stub it so
  // the test exercises real code with no network I/O, not to assert on it.
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => [], text: async () => '' }))
})

describe('renderSegmentToReel — links saveBroll to createClipDraft for the poster', () => {
  it('asks saveBroll to AWAIT the poster, not background it', async () => {
    await renderSegmentToReel({ ws: WS, seg: SEG, asset: ASSET, staffName: 'Dr. Q' })
    expect(saveBrollCalls).toHaveLength(1)
    expect(saveBrollCalls[0].awaitThumbnails).toBe(true)
  })

  it('forwards the poster saveBroll returns into createClipDraft', async () => {
    await renderSegmentToReel({ ws: WS, seg: SEG, asset: ASSET, staffName: 'Dr. Q' })
    expect(createClipDraftCalls).toHaveLength(1)
    expect(createClipDraftCalls[0].thumbnailUrl).toBe('https://blob.example/poster.jpg')
  })

  it('forwards the RENDERED clip asset id, not the source video id', async () => {
    await renderSegmentToReel({ ws: WS, seg: SEG, asset: ASSET, staffName: 'Dr. Q' })
    // Distinguishes "forwards the wrong id" from "forwards no id" — either
    // would be invisible without a source/clip id pair that actually differs.
    expect(createClipDraftCalls[0].assetId).toBe('clip-asset-1')
    expect(createClipDraftCalls[0].assetId).not.toBe(ASSET.id)
  })

  it('passes null, not undefined, when saveBroll could not produce a poster', async () => {
    // Mirrors saveBroll's own best-effort-failure shape (thumbnail_url simply
    // absent from the row, not present-and-null) — createClipDraft's default
    // param is `thumbnailUrl = null`, so `undefined` in must become `null` out,
    // never leak through as the literal string "undefined" or crash the call.
    saveBrollImpl = async (opts) => [{
      id: 'clip-asset-2',
      kind: 'video',
      blob_url: opts.renders[0].blobUrl,
    }]
    await renderSegmentToReel({ ws: WS, seg: SEG, asset: ASSET, staffName: 'Dr. Q' })
    expect(createClipDraftCalls[0].thumbnailUrl).toBeNull()
  })

  it('createDraft:false (manual render path) never calls createClipDraft', async () => {
    await renderSegmentToReel({ ws: WS, seg: SEG, asset: ASSET, staffName: 'Dr. Q', createDraft: false })
    expect(createClipDraftCalls).toHaveLength(0)
    // The poster chain up to saveBroll is unrelated to createDraft — still awaited.
    expect(saveBrollCalls[0].awaitThumbnails).toBe(true)
  })
})
