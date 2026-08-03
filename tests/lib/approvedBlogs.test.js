import { describe, it, expect } from 'vitest'
import { shapeApprovedBlog } from '../../api/_lib/approvedBlogs.js'

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
      staff_name: 'Dr. Q',
      approved_at: '2026-07-10T12:00:00Z',
      created_at: '2026-07-10T09:00:00Z',
      media_urls: [],
    }
    expect(shapeApprovedBlog(row)).toEqual({
      id: 'b33cdc9f',
      topic: 'Hip extension and opposite-shoulder stability',
      staffName: 'Dr. Q',
      approvedAt: '2026-07-10T12:00:00Z',
      createdAt: '2026-07-10T09:00:00Z',
      needsHero: true,
    })
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
