import { describe, it, expect } from 'vitest'
import { VIDEO_CHANNEL_SPECS } from '../../api/_lib/brandRenderVideo.js'
import { CHANNEL_DESTINATIONS } from '../../api/_lib/postFrames.js'
import { resolveChannelOverlayPosition } from '../../api/_lib/renderClipCore.js'

// The 4:5 carousel-slot video channel + per-channel caption placement, added so
// a 9:16 clip can join an Instagram carousel as a real re-bake instead of a
// letterbox. Numbers here are the ones actually verified by baking a real clip
// (2026-07-29) — see .claude/video-aspect-bake-design.md.

describe('instagram_carousel_video — the 4:5 video channel', () => {
  it('is registered on both the destination map and the video spec map', () => {
    expect(CHANNEL_DESTINATIONS.instagram_carousel_video)
      .toEqual({ platform: 'instagram', format: 'post' })
    expect(VIDEO_CHANNEL_SPECS.instagram_carousel_video).toBeTruthy()
  })

  it('renders 1080x1350 — exactly 0.8, Instagram\'s carousel aspect floor', () => {
    const spec = VIDEO_CHANNEL_SPECS.instagram_carousel_video
    expect(spec.width).toBe(1080)
    expect(spec.height).toBe(1350)
    expect(spec.aspect).toBe('4:5')
    // Live probe rejected anything below 0.8 ("image aspect ratio must be at
    // least 0.8"). Landing exactly on the floor is intentional, so guard it:
    // a future frame change that dips under would silently 400 every carousel.
    expect(spec.width / spec.height).toBeGreaterThanOrEqual(0.8)
  })

  it('is a DIFFERENT frame from the reel lane (that is the whole point)', () => {
    const reel = VIDEO_CHANNEL_SPECS.instagram_reel
    const carousel = VIDEO_CHANNEL_SPECS.instagram_carousel_video
    expect(reel.height).toBe(1920)
    expect(carousel.height).toBe(1350)
    expect(carousel.aspect).not.toBe(reel.aspect)
  })

  it('keeps captions top-positioned, matching the reel lane', () => {
    expect(VIDEO_CHANNEL_SPECS.instagram_carousel_video.captionPos).toBe('top')
  })
})

describe('resolveChannelOverlayPosition — per-channel caption placement', () => {
  it('a string applies to every channel (legacy single-channel behavior)', () => {
    expect(resolveChannelOverlayPosition('bottom', 'instagram_reel')).toBe('bottom')
    expect(resolveChannelOverlayPosition('bottom', 'instagram_carousel_video')).toBe('bottom')
  })

  it('an object places each channel independently', () => {
    const pos = { instagram_reel: 'top', instagram_carousel_video: 'bottom' }
    expect(resolveChannelOverlayPosition(pos, 'instagram_reel')).toBe('top')
    expect(resolveChannelOverlayPosition(pos, 'instagram_carousel_video')).toBe('bottom')
  })

  it('an unlisted channel returns undefined so the channel\'s own default wins', () => {
    // undefined is load-bearing: renderVideoChannel does `overlayPosition ??
    // spec.captionPos`, so returning undefined (NOT null, NOT '') is what lets
    // a secondary aspect fall back to its own captionPos.
    const pos = { instagram_reel: 'top' }
    expect(resolveChannelOverlayPosition(pos, 'instagram_carousel_video')).toBeUndefined()
  })

  it('passes undefined straight through when nothing was requested', () => {
    expect(resolveChannelOverlayPosition(undefined, 'instagram_reel')).toBeUndefined()
  })
})
