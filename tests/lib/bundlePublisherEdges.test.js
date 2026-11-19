// Four edge cases in BundlePublisher from the 2026-11-18 full audit (P2):
//  - deletePost never returned alreadyGone, so cancelling a post bundle had
//    already removed came back as a 502 the producer could not act on;
//  - _uploadMedia skipped an upload that returned no id, so a carousel could
//    publish missing a slide with no error;
//  - normalizeBundleAnalytics read items[] by position, not by createdAt;
//  - publish() threw a bare RangeError (opaque 500) on an unparseable scheduledAt.
// The SDK is replaced with a stub, so nothing reaches the network.

import { describe, it, expect, beforeAll } from 'vitest'
import { BundlePublisher, normalizeBundleAnalytics } from '../../api/_lib/social/bundlePublisher.js'

const WS = { id: '00000000-0000-0000-0000-000000000000', bundle_team_id: 'team_test' }

function publisherWith(sdk) {
  const p = new BundlePublisher(WS)
  p.sdk = sdk
  return p
}

function apiError(status) {
  return Object.assign(new Error(`HTTP ${status}`), { status })
}

describe('BundlePublisher edge cases', () => {
  beforeAll(() => { process.env.BUNDLE_API_KEY = process.env.BUNDLE_API_KEY || 'test-key' })

  it('deletePost reports alreadyGone when bundle answers 404', async () => {
    const p = publisherWith({ post: { postDelete: async () => { throw apiError(404) } } })
    await expect(p.deletePost({ postId: 'post_1' })).resolves.toEqual({ success: true, alreadyGone: true })
  })

  it('deletePost still throws on other bundle errors', async () => {
    const p = publisherWith({ post: { postDelete: async () => { throw apiError(500) } } })
    await expect(p.deletePost({ postId: 'post_1' })).rejects.toThrow('HTTP 500')
  })

  it('publish fails instead of dropping a media item whose upload has no id', async () => {
    let created = false
    let n = 0
    const p = publisherWith({
      upload: { uploadCreateFromUrl: async () => (++n === 2 ? {} : { id: `up_${n}`, type: 'image' }) },
      post: { postCreate: async () => { created = true; return { id: 'post_1' } } },
    })
    const media = [1, 2, 3].map((i) => ({ url: `https://x/${i}.jpg`, type: 'image', kind: 'image' }))
    await expect(p.publish({ platform: 'linkedin', content: 'hi', mediaUrls: media }))
      .rejects.toThrow(/no id for item 2 of 3/)
    expect(created).toBe(false)
  })

  it('publish rejects an unparseable scheduledAt as a 400, not a RangeError', async () => {
    const p = publisherWith({ post: { postCreate: async () => ({ id: 'post_1' }) } })
    const err = await p.publish({ platform: 'linkedin', content: 'hi', scheduledAt: 'not a date' }).catch((e) => e)
    expect(err).not.toBeInstanceOf(RangeError)
    expect(err.status ?? err.statusCode).toBe(400)
  })

  it('analytics reads the newest poll by createdAt, whatever the array order', () => {
    const newest = { likes: 9, createdAt: '2026-11-18T00:00:00Z' }
    const older = { likes: 2, createdAt: '2026-11-10T00:00:00Z' }
    expect(normalizeBundleAnalytics({ items: [newest, older] }).metrics.likes).toBe(9)
    expect(normalizeBundleAnalytics({ items: [older, newest] }).metrics.likes).toBe(9)
  })

  it('analytics falls back to the last item when createdAt is missing', () => {
    expect(normalizeBundleAnalytics({ items: [{ likes: 1 }, { likes: 4 }] }).metrics.likes).toBe(4)
  })
})
