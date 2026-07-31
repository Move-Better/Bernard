// Pins the rating-band contract. Two things here are load-bearing and were
// each verified by mutation (break the source, watch the named test go red):
//
//   1. Per-signal calibration. Quotes cut at 82/70, camera at 74/52. A single
//      shared threshold would put a segment's Strong (74) inside a quote's
//      Typical band — the badge would be confidently wrong on the video tab.
//   2. An unscored item is null, never "weak". Coercing null → 0 would paint
//      every unscored moment as the retire-lean band, a claim we haven't earned.

import { describe, it, expect } from 'vitest'
import { ratingBand, ratingTooltip, RATING_SIGNALS } from '../../src/lib/ratingBands.js'

describe('ratingBand — quote calibration', () => {
  it('cuts Strong at 82 inclusive', () => {
    expect(ratingBand(82, 'quote').key).toBe('strong')
    expect(ratingBand(81, 'quote').key).toBe('typical')
  })

  it('cuts Typical at 70 inclusive', () => {
    expect(ratingBand(70, 'quote').key).toBe('typical')
    expect(ratingBand(69, 'quote').key).toBe('weak')
  })

  it('covers the real observed range 60-90', () => {
    expect(ratingBand(90, 'quote').key).toBe('strong')
    expect(ratingBand(60, 'quote').key).toBe('weak')
  })
})

describe('ratingBand — camera calibration is genuinely different', () => {
  it('cuts Strong at 74 inclusive', () => {
    expect(ratingBand(74, 'camera').key).toBe('strong')
    expect(ratingBand(73, 'camera').key).toBe('typical')
  })

  it('cuts Typical at 52 inclusive', () => {
    expect(ratingBand(52, 'camera').key).toBe('typical')
    expect(ratingBand(51, 'camera').key).toBe('weak')
  })

  // The whole reason thresholds are per-signal. If someone ever collapses the
  // two calibrations into one shared cut, this is the test that catches it.
  it('scores 74-81 as Strong on camera but only Typical as a quote', () => {
    expect(ratingBand(74, 'camera').key).toBe('strong')
    expect(ratingBand(74, 'quote').key).toBe('typical')
    expect(ratingBand(81, 'camera').key).toBe('strong')
    expect(ratingBand(81, 'quote').key).toBe('typical')
  })

  it('scores 60 as Typical on camera but Weak as a quote', () => {
    expect(ratingBand(60, 'camera').key).toBe('typical')
    expect(ratingBand(60, 'quote').key).toBe('weak')
  })
})

describe('ratingBand — unscored is not weak', () => {
  it.each([null, undefined, NaN, '88', {}])('returns null for %p', (bad) => {
    expect(ratingBand(bad, 'quote')).toBeNull()
  })

  it('does not coerce a missing score into the weak band', () => {
    // Guards the exact regression: `score ?? 0` would land in weak.
    expect(ratingBand(null, 'quote')).not.toMatchObject({ key: 'weak' })
  })

  it('scores a real 0 as weak rather than null', () => {
    // 0 is a number we were given, unlike null — it must still band.
    expect(ratingBand(0, 'quote').key).toBe('weak')
  })
})

describe('band presentation', () => {
  it('uses the agreed words', () => {
    expect(ratingBand(88, 'quote').label).toBe('Strong')
    expect(ratingBand(75, 'quote').label).toBe('Typical')
    expect(ratingBand(62, 'quote').label).toBe('Weak')
  })

  // Weak leans retire; it must never borrow the destructive token, which in
  // this codebase means "Bernard produced something wrong".
  it('paints Weak with the action token, never destructive', () => {
    const weak = ratingBand(62, 'quote')
    expect(weak.text).toContain('action')
    expect(`${weak.text} ${weak.bg} ${weak.border}`).not.toContain('destructive')
  })

  it('paints Strong with success, not the brand primary', () => {
    const strong = ratingBand(88, 'quote')
    expect(strong.text).toContain('success')
    expect(strong.text).not.toContain('primary')
  })
})

describe('ratingTooltip', () => {
  it('names the consequence, not just the number', () => {
    const tip = ratingTooltip(88, 'quote')
    expect(tip).toContain('88/100')
    expect(tip).toContain('Strong')
    expect(tip).toMatch(/plans your week/i)
  })

  it('explains an unscored item instead of inventing a band', () => {
    expect(ratingTooltip(null, 'quote')).toMatch(/not scored yet/i)
  })

  // The old copy claimed 0-100 while the scorer only ever emits 60-90. No
  // tooltip should reintroduce that claim as a bare range.
  it('never describes the scale as a plain 0-100 range', () => {
    for (const key of Object.keys(RATING_SIGNALS)) {
      for (const band of ['strong', 'typical', 'weak']) {
        expect(RATING_SIGNALS[key].tips[band]).not.toMatch(/0\s*[-–]\s*100/)
      }
    }
  })

  it('falls back to the quote signal for an unknown key', () => {
    expect(ratingBand(88, 'nonsense').key).toBe(ratingBand(88, 'quote').key)
  })
})

describe('every signal is fully specified', () => {
  // Non-vacuity: if the discovery ever returns an empty set, the loops above
  // would pass trivially. Pin the known members.
  it('defines quote and camera', () => {
    expect(Object.keys(RATING_SIGNALS).sort()).toEqual(['camera', 'quote'])
  })

  it.each(['quote', 'camera'])('%s has thresholds and all three tips', (key) => {
    const sig = RATING_SIGNALS[key]
    expect(sig.thresholds.strong).toBeGreaterThan(sig.thresholds.typical)
    expect(sig.tips.strong).toBeTruthy()
    expect(sig.tips.typical).toBeTruthy()
    expect(sig.tips.weak).toBeTruthy()
    expect(sig.noun).toBeTruthy()
  })
})
