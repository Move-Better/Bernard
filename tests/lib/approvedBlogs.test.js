import { describe, it, expect } from 'vitest'
import { shapeApprovedBlog, shapeRecentlyPublishedBlog } from '../../api/_lib/approvedBlogs.js'

// The producer strip's whole job is answering "does this blog still need a hero
// image?". The rule has to agree with what publish/website.js will actually
// resolve, so these pin the disagreement cases rather than the happy path.

describe('shapeApprovedBlog — needsHero', () => {
  it('flags a blog with no media at all', () => {
    // The real shape of all 5 stranded posts: media_urls === [].
    expect(shapeApprovedBlog({ id: 'a', media_urls: [] }).needsHero).toBe(true)
  })

  it('flags a blog whose media_urls is null or missing', () => {
    expect(shapeApprovedBlog({ id: 'a', media_urls: null }).needsHero).toBe(true)
    expect(shapeApprovedBlog({ id: 'a' }).needsHero).toBe(true)
  })

  it('clears a blog that has a real photo attached', () => {
    // The shape 8 of the 10 published blogs actually carry.
    const row = { id: 'a', media_urls: [{ url: 'https://blob/hero.jpg', type: 'image' }] }
    expect(shapeApprovedBlog(row).needsHero).toBe(false)
  })

  // THE case this rule exists for. A video-only blog has non-empty media_urls,
  // so a `media_urls.length === 0` check would call it done — but pickHero only
  // accepts an image, so publish/website.js would send NO heroImage and the post
  // would ship heroless. Length and hero-ness are different questions.
  it('still flags a blog carrying ONLY a video — length is not hero-ness', () => {
    const row = {
      id: 'a',
      media_urls: [{ kind: 'video', mux_playback_id: 'pb_1', transcode_status: 'ready' }],
    }
    expect(row.media_urls.length).toBeGreaterThan(0)
    expect(shapeApprovedBlog(row).needsHero).toBe(true)
  })

  it('picks the image when a blog carries both a video and a photo', () => {
    const row = {
      id: 'a',
      media_urls: [
        { kind: 'video', mux_playback_id: 'pb_1' },
        { url: 'https://blob/hero.jpg', type: 'image' },
      ],
    }
    expect(shapeApprovedBlog(row).needsHero).toBe(false)
  })
})

describe('shapeApprovedBlog — row shape', () => {
  it('maps snake_case columns to the client contract and nulls the blanks', () => {
    const row = {
      id: 'b33cdc9f',
      topic: 'Hip extension and opposite-shoulder stability',
      staff_id: '9ad92a24-34ab-42cc-8cf4-74f582a2e504',
      staff_name: 'Dr. Q',
      approved_at: '2026-07-10T12:00:00Z',
      created_at: '2026-07-10T09:00:00Z',
      media_urls: [],
    }
    expect(shapeApprovedBlog(row)).toEqual({
      id: 'b33cdc9f',
      topic: 'Hip extension and opposite-shoulder stability',
      staffName: 'Dr. Q',
      staffId: '9ad92a24-34ab-42cc-8cf4-74f582a2e504',
      approvedAt: '2026-07-10T12:00:00Z',
      createdAt: '2026-07-10T09:00:00Z',
      needsHero: true,
    })
  })

  it('nulls a missing staff_id rather than leaking undefined', () => {
    expect(shapeApprovedBlog({ id: 'a', media_urls: [] }).staffId).toBeNull()
  })

  it('nulls an empty topic rather than leaking an empty string to the UI', () => {
    // The strip falls back to "Blog post" on null; '' would render a blank row.
    expect(shapeApprovedBlog({ id: 'a', topic: '', media_urls: [] }).topic).toBeNull()
    expect(shapeApprovedBlog({ id: 'a', staff_name: '', media_urls: [] }).staffName).toBeNull()
  })

  it('does not leak raw columns the client contract never promised', () => {
    const shaped = shapeApprovedBlog({ id: 'a', media_urls: [], content: 'secret body' })
    expect(shaped).not.toHaveProperty('content')
    expect(shaped).not.toHaveProperty('media_urls')
  })
})

// feedback c4b8f7c9 (2026-09-06): a producer picking the next queued blog has
// no visibility into who was published most recently. This pins the shape only
// — the row must stay raw/un-deduplicated (a real back-to-back repeat, seen
// live on movebetter 2026-09-06, is exactly the signal the strip exists for).
describe('shapeRecentlyPublishedBlog — row shape', () => {
  it('maps snake_case columns to the client contract', () => {
    const row = {
      id: '908',
      staff_id: '4dc8770f-fde4-43b5-8095-70412ecd8506',
      staff_name: 'Zach Cullen',
      published_at: '2026-09-06T21:33:10Z',
    }
    expect(shapeRecentlyPublishedBlog(row)).toEqual({
      id: '908',
      staffName: 'Zach Cullen',
      staffId: '4dc8770f-fde4-43b5-8095-70412ecd8506',
      publishedAt: '2026-09-06T21:33:10Z',
    })
  })

  it('nulls a missing staff name or staff_id rather than leaking undefined', () => {
    expect(shapeRecentlyPublishedBlog({ id: 'a', published_at: null }).staffName).toBeNull()
    expect(shapeRecentlyPublishedBlog({ id: 'a', published_at: null }).staffId).toBeNull()
  })

  it('does not leak raw columns the client contract never promised', () => {
    const shaped = shapeRecentlyPublishedBlog({ id: 'a', staff_name: 'Zach', published_at: null, content: 'secret body' })
    expect(shaped).not.toHaveProperty('content')
  })
})
