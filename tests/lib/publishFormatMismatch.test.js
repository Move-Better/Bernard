import { describe, it, expect, beforeAll } from 'vitest'
import { runBundlePublish } from '../../api/_routes/publish/social.js'
import { BundlePublisher } from '../../api/_lib/social/bundlePublisher.js'

// Regression for feedback 14ba3329 (2026-08-07): an Instagram piece with
// format='post' but 6 photos publishes → BundlePublisher.publish throws
// format_too_many_items (400) BEFORE any upload. runBundlePublish used to
// flatten EVERY throw to bundle_post_failed/502, so the producer saw only an
// opaque "Publish failed — bundle_post_failed". The real, actionable reason must
// now come through as a 400 with human copy.
//
// BUNDLE_API_KEY just has to be present for the BundlePublisher constructor; the
// format check throws before the SDK is ever called, so no network happens.
const PHOTO = (i) => ({ url: `https://x/${i}.jpg`, type: 'image', kind: 'image' })
const WORKSPACE = { id: '00000000-0000-0000-0000-000000000000', bundle_team_id: 'team_test' }

describe('runBundlePublish — format/media mismatch surfaces the real 400 reason', () => {
  beforeAll(() => { process.env.BUNDLE_API_KEY = process.env.BUNDLE_API_KEY || 'test-key' })

  it('returns a 400 with the human reason — not bundle_post_failed/502 — for an IG Post with 6 photos', async () => {
    const media = Array.from({ length: 6 }, (_, i) => PHOTO(i))
    const r = await runBundlePublish(WORKSPACE, {
      platform: 'instagram', content: 'hello', mediaUrls: media, format: 'post',
    })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('too_many_items')
    expect(r.body.error).not.toBe('bundle_post_failed')
    expect(r.body.message).toMatch(/Carousel/)
    expect(r.body.message).toMatch(/6 photos/)
  })

  it('passes through the reason for any format_* class error (Facebook mixed album)', async () => {
    // A photo+video Facebook "Post" fails validateFormatMedia (mixed_not_allowed),
    // which also throws before upload — so the assertion stays hermetic (no
    // network) and proves the passthrough isn't hard-coded to the too_many case.
    const VIDEO = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }
    const r = await runBundlePublish(WORKSPACE, {
      platform: 'facebook', content: 'hello', mediaUrls: [PHOTO(0), VIDEO], format: 'post',
    })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('mixed_not_allowed')
    expect(r.body.message).toContain('Facebook')
  })
})

// Regression for feedback 7f5bb584 (2026-08-24): a LinkedIn post with a photo
// failed to publish with "This post's format doesn't fit the attached media."
// The planner stamps format='post' on every non-story platform, but LinkedIn
// (like tiktok/twitter/gbp/…) has no entry in the format REGISTRY, so 'format'
// is a no-op legacy field there. publish() validated it anyway, so
// validateFormatMedia returned format_not_supported and hard-blocked EVERY
// publish on those channels. The guard now skips validation whenever the
// platform offers no format choice — mirroring describeFormatViolation and
// promoteFormatForMedia, which already guard the same way.
describe('BundlePublisher.publish — format is a no-op on non-REGISTRY platforms (feedback 7f5bb584)', () => {
  beforeAll(() => { process.env.BUNDLE_API_KEY = process.env.BUNDLE_API_KEY || 'test-key' })

  // Stub the network so publish() runs to completion without touching
  // bundle.social — the point under test is the pre-upload format guard, not the
  // upload itself.
  const makePub = () => {
    const pub = new BundlePublisher(WORKSPACE)
    pub._uploadMedia = async () => [{ id: 'up_1', type: 'image' }]
    pub.sdk = {
      post: {
        postCreate: async () => ({ id: 'post_1', status: 'SCHEDULED', postDate: '2026-01-01T00:00:00Z' }),
      },
    }
    return pub
  }

  it('a LinkedIn post with a photo publishes — the bogus format_not_supported block is gone', async () => {
    const pub = makePub()
    const r = await pub.publish({
      platform: 'linkedin', content: 'hello', mediaUrls: [PHOTO(0)], format: 'post',
    })
    expect(r.success).toBe(true)
    expect(r.postId).toBe('post_1')
  })

  it('still blocks a genuinely illegal format on a REGISTRY platform (IG Post, 6 photos)', async () => {
    // Proves the guard is scoped to non-REGISTRY platforms, not a blanket disable
    // of format validation — an Instagram Post over its 1-item cap must still 400.
    const pub = makePub()
    const media = Array.from({ length: 6 }, (_, i) => PHOTO(i))
    await expect(
      pub.publish({ platform: 'instagram', content: 'hi', mediaUrls: media, format: 'post' }),
    ).rejects.toThrow(/too_many_items/)
  })
})
