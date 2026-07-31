import { describe, it, expect } from 'vitest'
import { FORMATS, FORMAT_KEYS, channelFor, defaultFormatFor, normalizeFormat } from '../../src/lib/videoFormats.js'
import { CHANNEL_DESTINATIONS, frameFor } from '../../src/lib/postFrames.js'
import { VIDEO_CHANNEL_SPECS } from '../../api/_lib/brandRenderVideo.js'

// GUARD — the video editor's format picker previews at `dim` and bakes through
// `channelFor(shape, platform)`. Nothing at build, lint or type time connects
// those two: the picker is a CSS aspect-ratio string, the bake is a channel key
// resolved server-side. They drifted exactly that way once — "Square" previewed
// 1:1 while its channel (linkedin_video) rendered 4:5, so a user composed square
// and published 4:5, and "Portrait" silently rendered the identical frame.
//
// Every platform a video piece can reach the editor from. resolveArchetype()
// routes vvideo/lvideo pieces here, which is any platform that can carry video.
const PLATFORMS = [
  'instagram', 'instagram_story', 'facebook', 'linkedin', 'gbp',
  'tiktok', 'youtube_short', 'twitter', 'threads', 'bluesky', 'mastodon',
]

describe('video format picker — preview matches bake', () => {
  it('offers only shapes the renderer actually produces', () => {
    expect(FORMAT_KEYS.length).toBeGreaterThan(0)
    expect(Object.keys(FORMATS).sort()).toEqual([...FORMAT_KEYS].sort())
  })

  it.each(FORMAT_KEYS.flatMap((shape) => PLATFORMS.map((p) => [shape, p])))(
    'bakes %s on %s at the ratio the picker shows',
    (shape, platform) => {
      const channel = channelFor(shape, platform)
      // The channel must be a real, renderable video channel — an invented key
      // 400s at renderClipCore's `if (!specMap[c])` validation.
      expect(VIDEO_CHANNEL_SPECS[channel], `${channel} missing from VIDEO_CHANNEL_SPECS`).toBeTruthy()
      const dest = CHANNEL_DESTINATIONS[channel]
      expect(dest, `${channel} missing from CHANNEL_DESTINATIONS`).toBeTruthy()
      // The promise the UI makes === the frame the renderer bakes.
      expect(frameFor(dest.platform, dest.format).ratio).toBe(FORMATS[shape].dim)
    },
  )

  it('never resolves two different shapes to the same frame', () => {
    // Two options rendering an identical frame is what made "Square" and
    // "Portrait" indistinguishable in output while looking like a real choice.
    const ratios = FORMAT_KEYS.map((k) => FORMATS[k].dim)
    expect(new Set(ratios).size).toBe(ratios.length)
  })
})

describe('video format default — the reported LinkedIn bug', () => {
  it('opens a LinkedIn video post in Feed, not Reel', () => {
    expect(defaultFormatFor('linkedin')).toBe('feed')
  })

  it('opens a Google Business video post in Wide', () => {
    expect(defaultFormatFor('gbp')).toBe('wide')
  })

  it('still opens Instagram and TikTok in Reel', () => {
    expect(defaultFormatFor('instagram')).toBe('reel')
    expect(defaultFormatFor('tiktok')).toBe('reel')
    expect(defaultFormatFor('youtube_short')).toBe('reel')
  })

  it('falls back to Reel standalone, where there is no piece', () => {
    // Moment Miner / Slate open the editor on a bare asset with no platform.
    expect(defaultFormatFor(null)).toBe('reel')
    expect(defaultFormatFor(undefined)).toBe('reel')
  })

  it('resolves every default to a shape the picker offers', () => {
    for (const p of [...PLATFORMS, null]) {
      expect(FORMAT_KEYS).toContain(defaultFormatFor(p))
    }
  })
})

describe('saved drafts survive the shape rename', () => {
  it('restores a retired shape as the frame it actually baked', () => {
    // Both square and portrait rendered 4:5, so both are feed — dropping them
    // would silently reset a user's saved choice to the platform default.
    expect(normalizeFormat('square')).toBe('feed')
    expect(normalizeFormat('portrait')).toBe('feed')
  })

  it('leaves current shapes alone', () => {
    for (const k of FORMAT_KEYS) expect(normalizeFormat(k)).toBe(k)
  })
})
