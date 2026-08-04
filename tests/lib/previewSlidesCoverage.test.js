import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raw = readFileSync(fileURLToPath(new URL('../../src/components/PostPreview.jsx', import.meta.url)), 'utf8')
// Live code only — a commented-out prop must not satisfy any of this.
const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const dispatchFor = (platform) =>
  src.split('\n').find((l) => l.includes(`case '${platform}':`)) || ''

// publishPiece.js bakes slides for EVERY platform — the only exclusion is an
// Instagram Reel carrying video. So any platform whose posts can hold slides
// publishes the baked composite, and a preview that renders media_urls instead
// is showing something that did not ship. Facebook had this gap live (a post
// whose Facebook copy carried a headline and footer previewed as a bare photo);
// LinkedIn and GBP had it worse, rendering no image at all.
const SLIDE_BEARING = [
  'instagram',
  'facebook',
  'linkedin',
  'gbp',
  'twitter',
  'threads',
  'bluesky',
  'mastodon',
]

describe('every slide-bearing preview receives slides', () => {
  // Non-vacuity: if the dispatch is refactored and these lines stop matching,
  // every assertion below would trivially pass against empty strings.
  it('finds a dispatch line for each platform', () => {
    for (const p of SLIDE_BEARING) {
      expect(dispatchFor(p), `no dispatch line for ${p}`).toContain('return <')
    }
  })

  it.each(SLIDE_BEARING)('%s is passed slides', (platform) => {
    expect(dispatchFor(platform)).toContain('slides={slides}')
  })

  it.each(SLIDE_BEARING)('%s is passed the theme and aspect the bake used', (platform) => {
    const line = dispatchFor(platform)
    expect(line).toContain('photoTemplateId={photoTemplateId}')
    expect(line).toContain('aspectRatio={aspectRatio}')
  })

  it.each(SLIDE_BEARING)('%s renders SlidesCarousel, not just a media carousel', (platform) => {
    const line = dispatchFor(platform)
    const fn = line.match(/return <(\w+)/)?.[1]
    expect(fn, `could not read component for ${platform}`).toBeTruthy()
    const start = src.indexOf(`function ${fn}(`)
    expect(start, `no definition for ${fn}`).toBeGreaterThan(-1)
    const after = src.slice(start + 1)
    const body = after.slice(0, after.indexOf('\nfunction ') === -1 ? undefined : after.indexOf('\nfunction '))
    expect(body).toContain('<SlidesCarousel')
  })
})

// Deliberately NOT in the list above, so the exclusions are a recorded decision
// rather than an oversight the next reader has to re-derive.
describe('platforms deliberately outside the slide path', () => {
  it('instagram_story uses overlayText/textCard, not slides', () => {
    const line = dispatchFor('instagram_story')
    expect(line).toContain('overlayText')
    expect(line).not.toContain('slides={slides}')
  })

  it.each(['blog', 'landing_page', 'email'])('%s publishes off the social path entirely', (platform) => {
    expect(dispatchFor(platform)).not.toContain('slides={slides}')
  })

  it.each(['tiktok', 'youtube'])('%s is video-first and left alone for now', (platform) => {
    expect(dispatchFor(platform)).not.toContain('slides={slides}')
  })
})
