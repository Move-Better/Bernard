import { describe, it, expect } from 'vitest'
import { gradeToCanvasFilter, GRADE_VIBES, NEUTRAL_GRADE } from '../../src/lib/gradeParams.js'

// gradeToCanvasFilter used to emit `sepia(x) hue-rotate(185deg)` for any cool
// grade. The sepia scaled with warmth; the rotation did not — a flat 185° at
// every negative value. At warmth -16 that is sepia(0.042) over an otherwise
// intact image, so the rotation dominated and spun every hue half a turn,
// landing skin tones on cyan.
//
// It was not preview-only: overlayTemplates.js uses this as the carousel slide
// BAKE, so cool-graded photos were published hue-spun. Two of the four stock
// vibes carry negative warmth.
//
// There is no CSS/canvas primitive for the server's cool (a per-channel gain),
// so the fix is to emit nothing rather than something wrong.

const warmths = [-100, -55, -16, -6, -1, 1, 6, 16, 55, 100]

describe('gradeToCanvasFilter — never rotates hue', () => {
  it('emits no hue-rotate at any warmth', () => {
    for (const warmth of warmths) {
      expect(gradeToCanvasFilter({ warmth }), `warmth ${warmth}`).not.toContain('hue-rotate')
    }
  })

  it('emits no hue-rotate for any stock vibe', () => {
    for (const v of GRADE_VIBES) {
      expect(gradeToCanvasFilter(v.params), `vibe ${v.id}`).not.toContain('hue-rotate')
    }
  })

  it('still warms with sepia for positive warmth', () => {
    expect(gradeToCanvasFilter({ warmth: 55 })).toContain('sepia(')
  })

  it('does not sepia a COOL grade — sepia is a warming filter', () => {
    // The old code sepia'd cool grades too, purely as a substrate for the
    // rotation to act on. Without the rotation it would just warm them.
    expect(gradeToCanvasFilter({ warmth: -55 })).not.toContain('sepia(')
  })

  it('leaves the hue-independent terms intact', () => {
    const f = gradeToCanvasFilter({ exposure: 32, contrast: 6, saturation: 26, warmth: -16 })
    expect(f).toContain('brightness(')
    expect(f).toContain('contrast(')
    expect(f).toContain('saturate(')
  })

  it('is still a no-op for a neutral grade', () => {
    expect(gradeToCanvasFilter(NEUTRAL_GRADE)).toBe('none')
    expect(gradeToCanvasFilter({})).toBe('none')
  })

  it('the Bright & clean vibe is not a hue spin', () => {
    // The exact grade saved on the Move Better workspace.
    const f = gradeToCanvasFilter({ exposure: 32, contrast: 6, saturation: 26, warmth: -16, tint: 0, depth: 0 })
    expect(f).toBe('brightness(1.112) contrast(1.027) saturate(1.143)')
  })
})
