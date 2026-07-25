import { describe, it, expect } from 'vitest'
import { buildPhotoTemplateFromEditor, suggestPhotoTemplateName } from '../../src/lib/photoTemplateCapture.js'
import { resolveTheme, FONT_SIZE_PX } from '../../src/lib/photoTemplates.js'

// The slide editor's Text-layer controls are richer than the template schema, so
// a carousel could be styled beautifully and none of it was reusable. Capture
// promotes the overlap and NAMES the rest — a template that silently loses half
// your styling is worse than one that says what it took.

const THEME = 'photo-dark'
const base = resolveTheme(THEME, [])

const slide = (blocks) => ({ photo_idx: 0, template: 'cover', blocks })

describe('capture — what carries', () => {
  it('promotes a per-slide colour to the template', () => {
    const { config, captured } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', color: '#FF0000' }])], themeId: THEME,
    })
    expect(config.blocks.hook.color).toBe('#FF0000')
    expect(captured.join(' ')).toContain('#FF0000')
  })

  it('promotes fontWeight and uppercase', () => {
    const { config } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', fontWeight: 'normal', uppercase: true }])], themeId: THEME,
    })
    expect(config.blocks.hook.fontWeight).toBe('normal')
    expect(config.blocks.hook.uppercase).toBe(true)
  })

  it('folds fontScale into a NAMED size, since scale is relative and templates are named', () => {
    const themePx = FONT_SIZE_PX[base.blocks.hook.fontSize]
    const { config } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', fontScale: 0.5 }])], themeId: THEME,
    })
    expect(FONT_SIZE_PX[config.blocks.hook.fontSize]).toBeLessThan(themePx)
  })

  it('uses the MOST COMMON value per role, not the first slide', () => {
    // A template is "how you style hooks", not "how slide one looked".
    const { config } = buildPhotoTemplateFromEditor({
      slides: [
        slide([{ role: 'hook', text: 'a', color: '#111111' }]),
        slide([{ role: 'hook', text: 'b', color: '#222222' }]),
        slide([{ role: 'hook', text: 'c', color: '#222222' }]),
      ],
      themeId: THEME,
    })
    expect(config.blocks.hook.color).toBe('#222222')
  })

  it('keeps the base theme for roles the slides never touched', () => {
    const { config } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', color: '#FF0000' }])], themeId: THEME,
    })
    expect(config.blocks.cta).toMatchObject(base.blocks.cta)
  })

  it('carries layout, palette and structure so the template still renders', () => {
    const { config } = buildPhotoTemplateFromEditor({ slides: [slide([])], themeId: THEME })
    expect(config.layout).toBe(base.layout)
    expect(config.palette).toBe(base.palette)
    if (base.structure) expect(config.structure).toEqual(base.structure)
  })
})

describe('capture — what is named as skipped', () => {
  it('names editor-only styling the template schema cannot hold', () => {
    const { skipped } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', letterSpacing: 4, textEffect: 'glow', italic: true }])],
      themeId: THEME,
    })
    const joined = skipped.join(' ')
    expect(joined).toMatch(/letter spacing/i)
    expect(joined).toMatch(/text effect/i)
  })

  it('does not claim to skip things the slides never set', () => {
    const { skipped } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'x', color: '#FF0000' }])], themeId: THEME,
    })
    expect(skipped.join(' ')).not.toMatch(/letter spacing/i)
  })

  it('always says slide text and photos stay behind', () => {
    const { skipped } = buildPhotoTemplateFromEditor({ slides: [slide([])], themeId: THEME })
    expect(skipped.join(' ')).toMatch(/stay with this story/i)
  })

  it('never captures the slide TEXT itself', () => {
    const { config } = buildPhotoTemplateFromEditor({
      slides: [slide([{ role: 'hook', text: 'A very specific headline' }])], themeId: THEME,
    })
    expect(JSON.stringify(config)).not.toContain('A very specific headline')
  })
})

describe('capture — always explains itself', () => {
  it('says something even when nothing diverged from the base theme', () => {
    const { captured } = buildPhotoTemplateFromEditor({ slides: [slide([])], themeId: THEME })
    expect(captured.length).toBeGreaterThan(0)
    expect(captured.join(' ')).toMatch(/matches/i)
  })
})

describe('suggested name', () => {
  it('derives from the theme it diverged from', () => {
    expect(suggestPhotoTemplateName({ themeId: THEME })).toContain(base.name)
  })
})
