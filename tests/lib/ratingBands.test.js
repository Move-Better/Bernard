// Pins the rating-band contract. Three things here are load-bearing and were
// each verified by mutation (break the source, watch the named test go red):
//
//   1. Per-signal calibration. Quotes cut at 82/70, camera at 74/52. A single
//      shared threshold would put a segment's Strong (74) inside a quote's
//      Typical band — the badge would be confidently wrong on the video tab.
//   2. An unscored item is null, never "weak". Coercing null → 0 would paint
//      every unscored moment as the retire-lean band, a claim we haven't earned.
//   3. Every bg-*/N alpha class this file emits actually compiles. Tailwind
//      v3.4.1's JIT silently drops certain two-digit opacity fractions with
//      NO build/lint error — reproduced against a stock `bg-red-500/12`, so
//      this is an upstream bug, not a config issue (see the comment on the
//      weak band's `bg` value). `bg-action/12` shipped to prod this way:
//      fully transparent background, only caught by inspecting computed
//      styles on the live page — lint, build, and 24 unit tests all stayed
//      green through it. Static tests can't run the real Tailwind compiler,
//      so this guard is a source-level proxy: any bare `/N` alpha modifier
//      must be a value already confirmed to compile (see KNOWN_SAFE_FRACTIONS
//      below); any other fraction must use bracket syntax, which routes
//      through a different, unaffected parser path.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

// Fractions directly confirmed to compile in this repo's Tailwind build
// (checked against the emitted CSS, 2026-07-31) — extend this list only after
// the same check, never on the assumption that "it's just a number".
const KNOWN_SAFE_FRACTIONS = new Set([
  0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 75, 80, 90, 95, 100,
])

describe('every bg-*/N alpha class either compiles or uses bracket syntax', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/lib/ratingBands.js', import.meta.url)), 'utf8')

  // Matches the bare-fraction form (bg-action/12) but not bracket form
  // (bg-action/[0.12]) or the un-suffixed base (bg-action).
  const bareFraction = /\bbg-[a-z-]+\/(\d+)\b/g

  it('finds at least one bg-*/N class to check (non-vacuity)', () => {
    // If this file stops using tinted backgrounds at all, the loop below
    // would pass trivially with nothing checked — pin that it never goes
    // vacuous silently.
    const bg = src.match(/\bbg-[a-z-]+\/(\[[^\]]+\]|\d+)/g) || []
    expect(bg.length).toBeGreaterThan(0)
  })

  it('every bare fraction is a value already proven to compile', () => {
    const offenders = []
    for (const match of src.matchAll(bareFraction)) {
      const n = Number(match[1])
      if (!KNOWN_SAFE_FRACTIONS.has(n)) offenders.push(match[0])
    }
    expect(offenders).toEqual([])
  })
})
