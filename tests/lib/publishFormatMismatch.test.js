import { describe, it, expect, beforeAll } from 'vitest'
import { runBundlePublish } from '../../api/_routes/publish/social.js'

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
