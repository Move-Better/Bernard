import { describe, it, expect } from 'vitest'
import { instagramFeedFrame, IG_TALLEST_AR, IG_WIDEST_AR } from '@/lib/instagramFrame'

describe('instagramFeedFrame — what the feed actually does to a photo', () => {
  // Real dimensions from the Move Better library, with the crop each one takes.
  it('clamps a very tall photo to 4:5 and reports the loss', () => {
    const f = instagramFeedFrame(1125, 1967) // 0.572
    expect(f.aspect).toBe(IG_TALLEST_AR)
    expect(f.croppedPct).toBe(29)
    expect(f.trims).toBe('the top and bottom')
  })

  it('barely trims a 3:4 portrait', () => {
    const f = instagramFeedFrame(1500, 2000) // 0.750
    expect(f.aspect).toBe(IG_TALLEST_AR)
    expect(f.croppedPct).toBe(6)
  })

  it('leaves a 4:3 landscape completely alone', () => {
    const f = instagramFeedFrame(2000, 1500) // 1.333
    expect(f.croppedPct).toBe(0)
    expect(f.trims).toBe(null)
    // …and renders at its own ratio, not a square.
    expect(f.aspect).toBeCloseTo(1.333, 3)
  })

  it('trims the sides of an ultra-wide panorama', () => {
    const f = instagramFeedFrame(3000, 1000) // 3.0
    expect(f.aspect).toBe(IG_WIDEST_AR)
    expect(f.croppedPct).toBe(36)
    expect(f.trims).toBe('the sides')
  })

  it('treats the exact boundaries as uncropped', () => {
    expect(instagramFeedFrame(800, 1000).croppedPct).toBe(0)  // exactly 4:5
    expect(instagramFeedFrame(1910, 1000).croppedPct).toBe(0) // exactly 1.91:1
  })

  it('a square posts untouched — it is inside the range, just never what we have', () => {
    const f = instagramFeedFrame(1080, 1080)
    expect(f.croppedPct).toBe(0)
    expect(f.aspect).toBe(1)
  })

  it('returns null for unusable dimensions rather than a broken aspect', () => {
    expect(instagramFeedFrame(0, 100)).toBe(null)
    expect(instagramFeedFrame(100, 0)).toBe(null)
    expect(instagramFeedFrame(null, null)).toBe(null)
    expect(instagramFeedFrame(undefined, 500)).toBe(null)
    expect(instagramFeedFrame(NaN, 500)).toBe(null)
    expect(instagramFeedFrame(-100, 500)).toBe(null)
  })
})
