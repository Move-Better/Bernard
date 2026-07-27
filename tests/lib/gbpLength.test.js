import { describe, it, expect } from 'vitest'
import { resolveRange, lengthLine, platformCap, LEANS } from '../../api/_lib/socialLengthTargets.js'

// A Google Business post is a local listing card, not an article. Google shows
// ~100 characters before truncating, so length past a few short sentences is
// spent on a surface almost nobody reads.
//
// Before 2026-07-27 the two GBP angles sat in the `medium` lane at 300–550 and
// 450–780 chars. Measured on prod: movebetter (indepth) was told 518–897 and
// produced 1083–1650 across all 14 of its GBP posts — every single one above
// the top of its range, i.e. the target was being ignored, not narrowly missed.
// Shortening the numbers alone would have moved an ignored number, so the
// prompt's structural beats were trimmed to match (atomPrompts.js) and the
// angles moved to the `short` lane. An old-vs-new harness on a real transcript
// measured 983 -> 408 and 1116 -> 463 average characters.
describe('GBP length targets — a listing card, not an article', () => {
  const ANGLES = ['local_authority', 'patient_outcome']

  it('keeps both angles well inside a few short sentences', () => {
    for (const angle of ANGLES) {
      const r = resolveRange('gbp', angle, 'balanced')
      expect(r, `gbp/${angle} has no range`).not.toBeNull()
      expect(r.unit).toBe('chars')
      // Google truncates around 100 chars; anything past ~500 is an article.
      expect(r.hi, `gbp/${angle} top of range is too long for a listing card`).toBeLessThanOrEqual(500)
      expect(r.lo).toBeGreaterThan(100)
    }
  })

  // The regression that made this necessary: `medium` let the indepth dial
  // inflate GBP 1.15x. The module's own rule is that the dial decides how deep
  // the DEEP posts go — a listing card stays a listing card, the same way a
  // hook stays a hook. `short` scales 0.85/1/1.05, so the spread stays tight.
  it('barely moves across the whole lean dial', () => {
    for (const angle of ANGLES) {
      const tops = LEANS.map((lean) => resolveRange('gbp', angle, lean).hi)
      const spread = Math.max(...tops) / Math.min(...tops)
      expect(spread, `gbp/${angle} swings ${tops.join('/')} across leans — it is not in the short lane`)
        .toBeLessThan(1.3)
      // Even the most in-depth clinic gets a listing card, not an essay.
      expect(Math.max(...tops)).toBeLessThanOrEqual(520)
    }
  })

  it('never targets anywhere near the 1500 hard cap', () => {
    const cap = platformCap('gbp')
    expect(cap).toBe(1500)
    for (const angle of ANGLES) {
      for (const lean of LEANS) {
        // The cap is a guardrail, never the aim. Targeting close to it is what
        // produced the over-cap rows the clamp now has to catch.
        expect(resolveRange('gbp', angle, lean).hi).toBeLessThan(cap * 0.4)
      }
    }
  })

  it('still tells the model the hard ceiling and the ~100-char fold', () => {
    // Shortening the target must not drop the two guardrails that keep a GBP
    // post publishable and readable.
    const line = lengthLine('gbp', 'patient_outcome', 'indepth')
    expect(line).toMatch(/Never exceed 1500 characters/)
    expect(line).toMatch(/100-character preview/)
  })
})
