import { describe, it, expect } from 'vitest'
import {
  POST_FRAMES as SERVER_FRAMES,
  FRAME_PIXELS as SERVER_PIXELS,
  KEEP_WHOLE_FORMATS as SERVER_KEEP_WHOLE,
  SAFE_INSETS as SERVER_INSETS,
  CHANNEL_DESTINATIONS as SERVER_CHANNELS,
  frameFor as serverFrameFor,
  safeInsetBottomFor as serverSafeInsetBottomFor,
} from '../../api/_lib/postFrames.js'
import { EDITORIAL_ASPECTS } from '../../api/_lib/brandRender.js'
import {
  POST_FRAMES,
  FRAME_PIXELS,
  KEEP_WHOLE_FORMATS,
  SAFE_INSETS,
  CHANNEL_DESTINATIONS,
  frameFor,
  safeInsetBottomFor,
  splitPlatformKey,
} from '../../src/lib/postFrames.js'

// The client table and the server table are hand-mirrored (api/* must not pull
// the client module graph into a function bundle — same arrangement as
// CAPTION_LIMITS / socialLengthTargets.js). These assertions are the only thing
// stopping the two from drifting the way CHANNEL_SPECS and VIDEO_CHANNEL_SPECS
// did, so they compare the WHOLE structure rather than spot-checking keys.
describe('postFrames — client and server mirrors stay in step', () => {
  it('declares identical platform → format → ratio tables', () => {
    expect(SERVER_FRAMES).toEqual(POST_FRAMES)
  })

  it('declares identical pixel dimensions per ratio', () => {
    expect(SERVER_PIXELS).toEqual(FRAME_PIXELS)
  })

  it('declares identical legacy channel → destination maps', () => {
    expect(SERVER_CHANNELS).toEqual(CHANNEL_DESTINATIONS)
  })

  it('agrees on which formats keep the whole frame', () => {
    expect([...SERVER_KEEP_WHOLE].sort()).toEqual([...KEEP_WHOLE_FORMATS].sort())
  })

  it('resolves every declared pair to the same frame on both sides', () => {
    for (const [platform, formats] of Object.entries(POST_FRAMES)) {
      for (const format of Object.keys(formats)) {
        expect(serverFrameFor(platform, format)).toEqual(frameFor(platform, format))
      }
    }
  })
})

describe('postFrames — the values that were actually wrong', () => {
  // Instagram used to be a single `instagram_feed: 1:1` key, which could express
  // neither the 4:5 feed nor the 9:16 reel/story. One platform, three frames.
  it('gives Instagram a different frame per format', () => {
    expect(frameFor('instagram', 'post').ratio).toBe('4:5')
    expect(frameFor('instagram', 'reel').ratio).toBe('9:16')
    expect(frameFor('instagram', 'story').ratio).toBe('9:16')
  })

  // GBP had no entry at all and fell through to 4:5 portrait — which Google
  // clips in both the Maps carousel and the Search preview card.
  it('renders GBP at 4:3, the only ratio Google does not clip', () => {
    expect(frameFor('gbp', 'post')).toMatchObject({ ratio: '4:3', width: 1200, height: 900 })
  })

  // Meta unified FB Stories / FB Reels / IG Stories / IG Reels onto one 9:16
  // safe zone in March 2026 — one vertical master serves all four.
  it('renders all four Meta vertical placements at the same 9:16', () => {
    const frames = [
      frameFor('instagram', 'reel'), frameFor('instagram', 'story'),
      frameFor('facebook', 'reel'),  frameFor('facebook', 'story'),
    ]
    expect(new Set(frames.map((f) => f.ratio))).toEqual(new Set(['9:16']))
  })

  it('letterboxes only the keep-whole longform lane', () => {
    expect(frameFor('youtube', 'longform').keepWhole).toBe(true)
    expect(frameFor('youtube', 'short').keepWhole).toBe(false)
    expect(frameFor('instagram', 'post').keepWhole).toBe(false)
  })
})

describe('postFrames — resolution fallbacks', () => {
  it('falls back to the platform\'s own primary surface for an unknown format', () => {
    // Not a global default: an unknown Instagram format should still be an
    // Instagram frame, not a generic one.
    expect(frameFor('instagram', 'nonsense').ratio).toBe(POST_FRAMES.instagram.post)
  })

  it('falls back to a safe social frame for an unknown platform', () => {
    expect(frameFor('some_new_network', 'post').ratio).toBe('4:5')
  })

  it('is case-insensitive on the platform key', () => {
    expect(frameFor('Instagram', 'reel').ratio).toBe('9:16')
  })

  it('survives a null/undefined platform without throwing', () => {
    expect(() => frameFor(null)).not.toThrow()
    expect(() => frameFor(undefined, undefined)).not.toThrow()
    expect(frameFor(null).ratio).toBe('4:5')
  })

  it('returns real pixel dimensions for every declared ratio', () => {
    for (const formats of Object.values(POST_FRAMES)) {
      for (const ratio of Object.values(formats)) {
        expect(FRAME_PIXELS[ratio], `missing pixels for ${ratio}`).toBeDefined()
      }
    }
  })
})

describe('postFrames — the compositor can actually render every frame', () => {
  // renderEditorialPhoto looks the ratio up in EDITORIAL_ASPECTS and SILENTLY
  // falls back to 4:5 when it misses. So a ratio can be correct in the registry,
  // wired into the handler, pass every other test — and still render at the old
  // wrong shape. Adding GBP (4:3) to the registry without adding 4:3 here would
  // have no-op'd the entire fix with nothing to show for it.
  it('has an EDITORIAL_ASPECTS entry for every ratio the registry can return', () => {
    const ratios = new Set(Object.values(POST_FRAMES).flatMap((f) => Object.values(f)))
    for (const ratio of ratios) {
      expect(EDITORIAL_ASPECTS[ratio], `EDITORIAL_ASPECTS is missing ${ratio}`).toBeDefined()
    }
  })

  it('agrees with the registry on the pixels for each shared ratio', () => {
    for (const [ratio, pixels] of Object.entries(FRAME_PIXELS)) {
      if (EDITORIAL_ASPECTS[ratio]) expect(EDITORIAL_ASPECTS[ratio]).toEqual(pixels)
    }
  })
})

describe('postFrames — safe insets keep content out of the destination\'s crop', () => {
  it('mirrors the inset table on both sides', () => {
    expect(SERVER_INSETS).toEqual(SAFE_INSETS)
  })

  it('insets GBP, which crops its own previews', () => {
    expect(safeInsetBottomFor('gbp')).toBeGreaterThan(0)
    expect(serverSafeInsetBottomFor('gbp')).toBe(safeInsetBottomFor('gbp'))
  })

  it('leaves every full-frame destination at zero', () => {
    for (const platform of ['instagram', 'instagram_story', 'facebook', 'linkedin', 'tiktok', 'blog']) {
      expect(safeInsetBottomFor(platform), `${platform} should need no inset`).toBe(0)
    }
  })

  it('is zero for an unknown platform rather than undefined', () => {
    expect(safeInsetBottomFor('some_new_network')).toBe(0)
    expect(safeInsetBottomFor(null)).toBe(0)
  })

  // The inset shifts the footer up by a fraction of HEIGHT, so a value near or
  // above 1 would push it off the card entirely.
  it('stays well inside the frame', () => {
    for (const inset of Object.values(SAFE_INSETS)) {
      expect(inset.bottom).toBeLessThan(0.4)
      expect(inset.top).toBeLessThan(0.4)
    }
  })
})

describe('postFrames — Bernard\'s compound platform keys', () => {
  it('reads the format out of instagram_story, a real platform value', () => {
    expect(splitPlatformKey('instagram_story')).toEqual({ platform: 'instagram', format: 'story' })
    expect(frameFor('instagram_story').ratio).toBe('9:16')
  })

  it('leaves a plain platform key alone', () => {
    expect(splitPlatformKey('instagram')).toEqual({ platform: 'instagram', format: undefined })
  })

  // `landing_page` ends in `_page`, not a format suffix — and `youtube_short`
  // must not be mistaken for a `youtube` + `short` split it can't resolve.
  it('does not split a key whose stem is not a real platform', () => {
    expect(splitPlatformKey('landing_page').platform).toBe('landing_page')
    expect(frameFor('landing_page').ratio).toBe('16:9')
  })

  it('resolves youtube_short to the 9:16 short, not the 16:9 longform', () => {
    expect(frameFor('youtube_short').ratio).toBe('9:16')
  })
})
