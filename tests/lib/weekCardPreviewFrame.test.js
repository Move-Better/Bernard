import { describe, it, expect } from 'vitest'
import { previewFrame } from '@/pages/YourWeek'

// The week board's media tile renders at the aspect the post PUBLISHES at, not
// the aspect of the source file — a fixed-height tile shows a random horizontal
// strip of a portrait photo. These pin the mapping, using the real dimensions
// off a live week (workspace movebetter, plan_week 2026-07-27).

const ig = (extra = {}) => ({ platform: 'instagram', format: 'post', ...extra })

describe('previewFrame', () => {
  it('renders a feed photo already inside Instagram range at its own aspect', () => {
    // 2000x1500 — a real 4:3 landscape on that week; 1.33 sits between 0.8 and 1.91
    expect(previewFrame(ig(), { w: 2000, h: 1500 })).toEqual({ aspect: 2000 / 1500, crop: 0 })
  })

  it('clamps a too-tall feed photo to 4:5 and reports what is lost', () => {
    // 1125x2000 — a real 9:16 photo scheduled to the Instagram FEED, where the
    // platform keeps a 4:5 window out of the middle and discards 30% of it.
    // This is the case the card flags.
    expect(previewFrame(ig(), { w: 1125, h: 2000 })).toEqual({ aspect: 0.8, crop: 30 })
  })

  it('reports the small trim on a 3:4 photo without pretending it is untouched', () => {
    // 1500x2000 — the most common shape on the board. Really is cropped, but
    // only by 6%, which is below the card's flag threshold.
    expect(previewFrame(ig(), { w: 1500, h: 2000 })).toEqual({ aspect: 0.8, crop: 6 })
  })

  it('leaves non-Instagram channels at the photo’s own shape', () => {
    // Google Business does not impose Instagram's window, so the same 3:4 photo
    // that Instagram trims posts whole here.
    const gbp = { platform: 'gbp', format: 'post' }
    expect(previewFrame(gbp, { w: 1500, h: 2000 })).toEqual({ aspect: 0.75, crop: 0 })
  })

  it('sizes reels and stories 9:16 regardless of the poster it was given', () => {
    // A reel publishes vertical whatever its poster frame happens to be, so the
    // poster's own dimensions must not leak into the tile.
    for (const format of ['reel', 'story']) {
      expect(previewFrame(ig({ format }), { w: 4000, h: 500 })).toEqual({ aspect: 9 / 16, crop: 0 })
    }
  })

  it('returns null for a photo whose size is not known yet', () => {
    // The aspect is measured as the thumbnail loads, so every card renders at
    // least once before it is known — the caller falls back to a square box.
    expect(previewFrame(ig(), null)).toBeNull()
    expect(previewFrame(ig(), { w: 0, h: 0 })).toBeNull()
  })

  it('does not need dimensions for a reel, which has a fixed shape', () => {
    // Guards the ordering: the vertical-format branch must come BEFORE the
    // dimensions check, or a reel would render as a square until its poster
    // loaded and then jump.
    expect(previewFrame(ig({ format: 'reel' }), null)).toEqual({ aspect: 9 / 16, crop: 0 })
  })
})
