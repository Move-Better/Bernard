// SlideEditor's autosave rebuilds every slide from a whitelist, then bakes and
// persists that rebuilt slide. Three things the editor sets per slide were not
// on the list (audit 2026-11-18, full):
//   - objects (the logo / watermark layer), read by renderSlides when baking
//   - scrim ('off' = publish the photo untouched), read by renderSlides
//   - rendered_url + rendered_sig, the bake cache key ensureRenderedSlides checks
// So a logo or the scrim-off choice vanished on the next autosave, never
// reached the published image, and every edit re-rendered and re-uploaded
// every slide in the carousel.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanSlidesForSave } from '../../src/lib/slideSave.js'

describe('SlideEditor autosave uses the shared whitelist', () => {
  const src = readFileSync(new URL('../../src/components/story-detail/SlideEditor.jsx', import.meta.url), 'utf8')
  it('calls cleanSlidesForSave on the slides it bakes and persists', () => {
    expect(src.match(/cleanSlidesForSave\(next\.slides\)/g)?.length).toBe(1)
  })
  it('does not rebuild slides inline again (a second whitelist drifts)', () => {
    expect(src).not.toMatch(/next\.slides\.map\(\(s\) => \(\{/)
  })
})

const slide = {
  photo_idx: 0,
  template: 'photo-dark',
  blocks: [{ text: 'Hello', role: 'headline' }, { text: '   ' }],
  objects: [{ type: 'logo', src: 'https://blob.test/logo.png', x: 0.8, y: 0.1, scale: 0.2, opacity: 1 }],
  scrim: 'off',
  rendered_url: 'https://blob.test/slide-1.png',
  rendered_sig: 'abc123',
}

describe('cleanSlidesForSave', () => {
  const [out] = cleanSlidesForSave([slide])

  it('keeps the logo / watermark layer', () => {
    expect(out.objects).toEqual(slide.objects)
  })

  it('keeps the scrim choice', () => {
    expect(out.scrim).toBe('off')
  })

  it('keeps the bake cache key so an unchanged slide is not re-rendered', () => {
    expect(out.rendered_url).toBe(slide.rendered_url)
    expect(out.rendered_sig).toBe(slide.rendered_sig)
  })

  it('still drops empty text blocks', () => {
    expect(out.blocks).toEqual([{ text: 'Hello', role: 'headline' }])
  })

  it('omits the new fields when a slide does not have them, so legacy rows stay identical', () => {
    const [bare] = cleanSlidesForSave([{ photo_idx: 1, template: 't', blocks: [] }])
    expect(bare).not.toHaveProperty('objects')
    expect(bare).not.toHaveProperty('scrim')
    expect(bare).not.toHaveProperty('rendered_url')
    expect(bare).not.toHaveProperty('rendered_sig')
  })
})
