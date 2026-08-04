import { describe, it, expect } from 'vitest'
import { CHANNEL_TO_PLATFORM, groupRendersByPlatform } from '../../api/_lib/packageChannelPlatform.js'

// The bug this file exists to prevent: f32f8ac0 (deleted 2026-08-03) was a
// content_items row with platform:'blog', interview_id:null, created by
// approving a Story Slate package whose renders included a blog_hero_video
// channel. It could never pass checkWordsApproved (no interview to check
// against) and so could never publish — it just sat in the blog pipeline
// invisibly until the producer strip gave it somewhere to show up.

describe('CHANNEL_TO_PLATFORM — the blog-hero exclusion', () => {
  it('does NOT map blog_hero, blog_hero_video, or website_embed to any platform', () => {
    // A blog post is only ever written from an interview (Q, 2026-08-01); the
    // package-approval path has no interview behind it, so none of these
    // channels may resolve to a publishable platform.
    for (const channel of ['blog_hero', 'blog_hero_video', 'website_embed']) {
      expect(CHANNEL_TO_PLATFORM[channel]).toBeUndefined()
    }
  })

  it('still maps every real publish channel — the exclusion is narrow, not a regression', () => {
    const stillMapped = {
      linkedin_feed: 'linkedin', linkedin_video: 'linkedin', linkedin_native: 'linkedin',
      instagram_reel_still: 'instagram', instagram_reel: 'instagram', instagram_feed: 'instagram',
      tiktok_still: 'tiktok', tiktok: 'tiktok',
      youtube_short: 'youtube', youtube: 'youtube',
      facebook_feed: 'facebook', facebook_video: 'facebook',
      gbp_post: 'gbp',
    }
    for (const [channel, platform] of Object.entries(stillMapped)) {
      expect(CHANNEL_TO_PLATFORM[channel]).toBe(platform)
    }
  })
})

describe('groupRendersByPlatform', () => {
  it('groups renders that share a platform into one entry, in render order', () => {
    const renders = [
      { channel: 'linkedin_feed', blobUrl: 'a.jpg' },
      { channel: 'linkedin_video', blobUrl: 'b.mp4' },
      { channel: 'instagram_feed', blobUrl: 'c.jpg' },
    ]
    const { byPlatform, skipped } = groupRendersByPlatform(renders)
    expect(skipped).toEqual([])
    expect(Object.keys(byPlatform).sort()).toEqual(['instagram', 'linkedin'])
    expect(byPlatform.linkedin.renders.map((r) => r.blobUrl)).toEqual(['a.jpg', 'b.mp4'])
    expect(byPlatform.instagram.renders.map((r) => r.blobUrl)).toEqual(['c.jpg'])
  })

  // THE case this module exists for. A package whose renders are a real post
  // plus a blog-hero frame must produce a content_items row for the real post
  // and drop the blog-hero render — not a spurious 'blog' row.
  it('drops blog_hero_video from grouping while keeping its sibling renders', () => {
    const renders = [
      { channel: 'gbp_post', blobUrl: 'hero.jpg' },
      { channel: 'blog_hero_video', blobUrl: 'blog_hero_video-C0093.mp4' },
    ]
    const { byPlatform, skipped } = groupRendersByPlatform(renders)
    expect(Object.keys(byPlatform)).toEqual(['gbp'])
    expect(byPlatform.blog).toBeUndefined()
    expect(skipped).toEqual(['blog_hero_video'])
  })

  it('a package containing ONLY blog-hero renders produces no platform at all', () => {
    // This is what makes approve-package.js correctly 409 with
    // no_publishable_renders rather than silently creating an unpublishable
    // blog stub — the exact failure mode f32f8ac0 was.
    const renders = [
      { channel: 'blog_hero', blobUrl: 'hero.jpg' },
      { channel: 'blog_hero_video', blobUrl: 'hero.mp4' },
    ]
    const { byPlatform, skipped } = groupRendersByPlatform(renders)
    expect(byPlatform).toEqual({})
    expect(skipped).toEqual(['blog_hero', 'blog_hero_video'])
  })

  it('is empty-safe on no renders or a non-array', () => {
    expect(groupRendersByPlatform([])).toEqual({ byPlatform: {}, skipped: [] })
    expect(groupRendersByPlatform(null)).toEqual({ byPlatform: {}, skipped: [] })
    expect(groupRendersByPlatform(undefined)).toEqual({ byPlatform: {}, skipped: [] })
  })

  it('records every skipped channel including duplicates, for accurate logging', () => {
    const renders = [{ channel: 'blog_hero' }, { channel: 'blog_hero' }, { channel: 'made_up' }]
    expect(groupRendersByPlatform(renders).skipped).toEqual(['blog_hero', 'blog_hero', 'made_up'])
  })
})
