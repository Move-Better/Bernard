import { describe, it, expect } from 'vitest'
import { buildBrandOverlaySvg, CHANNEL_SPECS } from '../../api/_lib/brandRender.js'

// The bottom caption band used to be anchored to the frame edge
// (captionBandY = height - captionBandHeight), which on a 16:9 frame put it at
// 886→1080 while the lower-third bar sat at 983→1080. The bar is painted after
// the caption, so it covered the bottom of the text, and the accent rule ran
// straight through the middle of it. Found by rendering a real video and looking
// at a frame — every dimension assertion passed the whole time.
//
// These parse the SVG the renderer actually emits rather than re-deriving the
// arithmetic, so they fail if the layout changes even when the maths still adds
// up on paper.

function bands(svg) {
  const rects = [...svg.matchAll(/<rect[^>]*y="(-?\d+)"[^>]*height="(\d+)"[^>]*>/g)]
    .map((m) => ({ y: Number(m[1]), h: Number(m[2]) }))
  return rects.map((r) => ({ ...r, bottom: r.y + r.h }))
}

function render(spec) {
  return buildBrandOverlaySvg({
    width: spec.width,
    height: spec.height,
    captionPos: spec.captionPos,
    captionText: 'Back in the water by week four, and swimming pain free since',
    staffName: 'Dr. Q',
    workspaceName: 'Move Better',
    primaryColor: '#0C7580',
    accentColor: '#F2A65A',
    fontBuffer: null,
  }).toString('utf8')
}

// blog_hero is the photo lane; the four video lanes share this builder via
// brandRenderVideo.js, and all of them are 16:9 bottom-caption.
const BOTTOM_LANES = { blog_hero: CHANNEL_SPECS.blog_hero }

describe('bottom caption band stacks above the lower third', () => {
  for (const [name, spec] of Object.entries(BOTTOM_LANES)) {
    it(`${name}: caption band does not reach the frame edge`, () => {
      const svg = render(spec)
      const caption = bands(svg)[0]
      expect(caption.bottom).toBeLessThan(spec.height)
    })

    it(`${name}: caption band clears the lower-third bar entirely`, () => {
      const svg = render(spec)
      const all = bands(svg)
      const caption = all[0]
      const lowerThird = all.find((r) => r.bottom === spec.height && r !== caption)
      expect(lowerThird, 'no lower-third bar found').toBeDefined()
      expect(caption.bottom).toBeLessThanOrEqual(lowerThird.y)
    })

    it(`${name}: every caption line sits inside the caption band`, () => {
      const svg = render(spec)
      const caption = bands(svg)[0]
      const ys = [...svg.matchAll(/<text[^>]*y="(\d+)"[^>]*font-size="(\d+)"/g)]
        .map((m) => ({ baseline: Number(m[1]), size: Number(m[2]) }))
      const captionLines = ys.filter((t) => t.baseline >= caption.y && t.baseline <= caption.bottom + t.size)
      expect(captionLines.length, 'no caption text rendered').toBeGreaterThan(0)
      for (const line of captionLines) {
        // Baseline minus cap height must clear the band top; baseline plus a
        // descender must clear the band bottom.
        expect(line.baseline - line.size).toBeGreaterThanOrEqual(caption.y - 1)
        expect(line.baseline + line.size * 0.25).toBeLessThanOrEqual(caption.bottom + 1)
      }
    })
  }
})

describe('top and centre bands are untouched by the bottom fix', () => {
  it('a top band still starts at the frame top', () => {
    const svg = render({ width: 1080, height: 1350, captionPos: 'top' })
    expect(bands(svg)[0].y).toBe(0)
  })

  it('a centre band is still vertically centred', () => {
    const h = 1350
    const svg = render({ width: 1080, height: h, captionPos: 'center' })
    const c = bands(svg)[0]
    // Equal slack above and below, within a rounding pixel.
    expect(Math.abs(c.y - (h - c.bottom))).toBeLessThanOrEqual(1)
  })
})
