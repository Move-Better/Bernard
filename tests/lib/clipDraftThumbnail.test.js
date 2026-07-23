import { describe, it, expect, vi, beforeEach } from 'vitest'

// GUARD — createClipDraft threads thumbnailUrl into the media_urls entry it
// inserts. The last unpinned link in the #2311 reel-poster chain (see
// reelFactoryPosterChain.test.js for the other two).
//
// createClipDraft routes its thumbnailUrl param through the shared
// clipToMediaEntry() normalizer (src/lib/mediaEntry.js) rather than
// hand-building the media_urls row — CLAUDE.md is explicit that a hand-rolled
// entry is how a video ships as a broken image. This test proves the thread
// survives that indirection into the actual POST body, not just that the
// function returns a truthy id.

const postedRows = []

const { createClipDraft } = await import('../../api/_lib/clipDraft.js')

const WS = { id: '11111111-1111-4111-8111-111111111111' }

beforeEach(() => {
  postedRows.length = 0
  globalThis.fetch = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    postedRows.push(body)
    return {
      ok: true,
      json: async () => [{ id: 'draft-1', ...body }],
      text: async () => '',
    }
  })
})

const BASE = {
  ws: WS,
  videoUrl: 'https://blob.example/clip.mp4',
  assetId: 'clip-asset-1',
  filename: 'clip.mp4',
  durationS: 22,
  caption: 'A voice-faithful caption.',
}

describe('createClipDraft — threads thumbnailUrl into the media_urls entry', () => {
  it('carries a provided thumbnailUrl onto the stored entry', async () => {
    await createClipDraft({ ...BASE, thumbnailUrl: 'https://blob.example/poster.jpg' })
    expect(postedRows).toHaveLength(1)
    expect(postedRows[0].media_urls[0].thumbnailUrl).toBe('https://blob.example/poster.jpg')
  })

  it('defaults to null, not undefined, when no poster exists yet', async () => {
    await createClipDraft(BASE) // no thumbnailUrl passed
    // A JSON.stringify of an `undefined` field DROPS the key entirely, which
    // is indistinguishable from "field never existed" — null is what proves
    // the entry-sync write-back (thumbnail.js) has something to find and fill.
    expect(postedRows[0].media_urls[0]).toHaveProperty('thumbnailUrl', null)
  })

  it('points mediaAssetId at the rendered clip, not left unset', async () => {
    await createClipDraft({ ...BASE, thumbnailUrl: 'https://blob.example/poster.jpg' })
    expect(postedRows[0].media_urls[0].mediaAssetId).toBe('clip-asset-1')
  })

  it('the entry url is the rendered clip blob, and thumbnailUrl is never conflated with it', async () => {
    await createClipDraft({ ...BASE, thumbnailUrl: 'https://blob.example/poster.jpg' })
    const entry = postedRows[0].media_urls[0]
    expect(entry.url).toBe('https://blob.example/clip.mp4')
    expect(entry.thumbnailUrl).not.toBe(entry.url)
  })
})
