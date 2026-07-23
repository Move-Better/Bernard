import { describe, it, expect } from 'vitest'
import { CHANNEL_SPECS } from '../../api/_lib/brandRender.js'
import { VIDEO_CHANNEL_SPECS } from '../../api/_lib/brandRenderVideo.js'
import { CHANNEL_DESTINATIONS, frameFor, FRAME_PIXELS } from '../../api/_lib/postFrames.js'

const ALL_SPECS = { ...CHANNEL_SPECS, ...VIDEO_CHANNEL_SPECS }

// CHANNEL_SPECS and VIDEO_CHANNEL_SPECS used to hand-maintain their own copies of
// every dimension, with a comment on the video table asking whoever edited one to
// remember the other. They drifted anyway — both carried 1:1 for LinkedIn while
// the platform renders feed posts at 4:5, and the photo table's `instagram_feed`
// was square. Both now derive from the (platform, format) registry, so the only
// way to change a dimension is to change it in one place.
describe('channel specs derive from the frame registry', () => {
  it('maps every render channel to a destination', () => {
    for (const channel of Object.keys(ALL_SPECS)) {
      expect(CHANNEL_DESTINATIONS[channel], `${channel} has no destination`).toBeDefined()
    }
  })

  it('has no orphan destinations for channels that no longer exist', () => {
    for (const channel of Object.keys(CHANNEL_DESTINATIONS)) {
      expect(ALL_SPECS[channel], `${channel} is mapped but not a real channel`).toBeDefined()
    }
  })

  it('takes every dimension from the registry, never a local literal', () => {
    for (const [channel, spec] of Object.entries(ALL_SPECS)) {
      const dest = CHANNEL_DESTINATIONS[channel]
      const frame = frameFor(dest.platform, dest.format)
      expect({ w: spec.width, h: spec.height, a: spec.aspect }, `${channel} drifted`)
        .toEqual({ w: frame.width, h: frame.height, a: frame.ratio })
    }
  })

  it('resolves every channel to real pixel dimensions', () => {
    for (const [channel, spec] of Object.entries(ALL_SPECS)) {
      expect(FRAME_PIXELS[spec.aspect], `${channel} has an unknown ratio`).toBeDefined()
      expect(spec.width, `${channel} width`).toBeGreaterThan(0)
      expect(spec.height, `${channel} height`).toBeGreaterThan(0)
    }
  })
})

describe('channel specs — render behaviour survives the consolidation', () => {
  // The frame moved to the registry; captionPos / fit / longform did NOT, because
  // they vary per channel rather than per destination. website_embed and
  // blog_hero_video share a frame but not a fit, so folding these into the
  // registry would have flattened a real distinction.
  it('keeps the three keep-whole long-form lanes letterboxed', () => {
    for (const channel of ['youtube', 'linkedin_native', 'website_embed']) {
      expect(VIDEO_CHANNEL_SPECS[channel].fit, `${channel} fit`).toBe('contain')
      expect(VIDEO_CHANNEL_SPECS[channel].longform, `${channel} longform`).toBe(true)
    }
  })

  it('leaves the clip lanes to cover-crop', () => {
    for (const channel of ['instagram_reel', 'tiktok', 'youtube_short', 'facebook_video']) {
      expect(VIDEO_CHANNEL_SPECS[channel].fit).toBeUndefined()
      expect(VIDEO_CHANNEL_SPECS[channel].longform).toBeUndefined()
    }
  })

  it('keeps captionPos on every channel', () => {
    for (const [channel, spec] of Object.entries(ALL_SPECS)) {
      expect(['top', 'bottom'], `${channel} captionPos`).toContain(spec.captionPos)
    }
  })

  // website_embed and blog_hero_video are the same shape and must stay so — the
  // package renderer groups channels by render signature to avoid encoding the
  // same video three times.
  it('keeps the landscape lanes identically sized so dedup still groups them', () => {
    const dims = (c) => `${VIDEO_CHANNEL_SPECS[c].width}x${VIDEO_CHANNEL_SPECS[c].height}`
    expect(new Set(['youtube', 'linkedin_native', 'website_embed', 'blog_hero_video'].map(dims)).size).toBe(1)
  })
})

describe('channel specs — the values that were wrong', () => {
  it('renders LinkedIn and Instagram feed posts at 4:5, not square', () => {
    expect(CHANNEL_SPECS.instagram_feed.aspect).toBe('4:5')
    expect(CHANNEL_SPECS.linkedin_feed.aspect).toBe('4:5')
    expect(VIDEO_CHANNEL_SPECS.linkedin_video.aspect).toBe('4:5')
  })

  it('agrees with the photo table wherever a video channel shares its destination', () => {
    // instagram_reel_still / instagram_reel both target instagram+reel.
    expect(CHANNEL_SPECS.instagram_reel_still.width).toBe(VIDEO_CHANNEL_SPECS.instagram_reel.width)
    expect(CHANNEL_SPECS.instagram_reel_still.height).toBe(VIDEO_CHANNEL_SPECS.instagram_reel.height)
    expect(CHANNEL_SPECS.blog_hero.aspect).toBe(VIDEO_CHANNEL_SPECS.blog_hero_video.aspect)
  })
})
