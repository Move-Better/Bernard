import { describe, it, expect } from 'vitest'
import { workspaceCaptionAccent, workspacePrimaryColor } from '../../src/lib/brandSwatches.js'
import { resolveBrandColors } from '../../api/_lib/brandRender.js'

// The karaoke highlight is an ACCENT WORD, so it takes the workspace's hero
// accent — the same colour templates put on the rule / CTA pill / accent word.
//
// It used to take resolveBrandColors().accentColor, a different chain
// (colors.accent → palette.accent → DEFAULT_ACCENT '#83957C'). On Move Better
// that lands on a sage green sitting in colors.accent — legacy seed data no
// route writes — while the brand's real accent is in brand_style.accent_color.
// Every reel highlighted spoken words in a muted secondary green, and because
// sage is genuinely in Move Better's palette it read as a design choice.

// Real prod shape for the movebetter workspace.
const MOVEBETTER = {
  colors: { accent: '#83957C' },                 // legacy seed, == DEFAULT_ACCENT
  brand_style: { accent_color: '#E36525' },      // the actual brand accent
  brand_visual_identity: { colorPalette: { accent: '#c8a573' } },
}

describe('caption accent — hero chain, not the legacy accent chain', () => {
  it('uses the brand accent on Move Better, not the sage in colors.accent', () => {
    expect(workspaceCaptionAccent(MOVEBETTER)).toBe('#E36525')
    expect(workspaceCaptionAccent(MOVEBETTER)).not.toBe('#83957C')
  })

  it('agrees with the hero accent used elsewhere', () => {
    expect(workspaceCaptionAccent(MOVEBETTER)).toBe(workspacePrimaryColor(MOVEBETTER))
  })

  it('matches the SERVER hero chain, so preview and bake cannot diverge', () => {
    // This is the drift the "KEEP IN SYNC" comments warn about: the client seeds
    // caption.accent and the server falls back to its own default. If the two
    // chains disagree, the editor preview styles one colour and the bake another.
    for (const ws of [
      MOVEBETTER,
      { brand_style: { accent_color: '#ff4000' } },                 // movebetter-equine
      { colors: { primary: '#123456' }, brand_style: { accent_color: '#E36525' } },
      { brand_visual_identity: { colorPalette: { foreground: '#abcdef' } } },
      {},                                                           // no brand config at all
    ]) {
      expect(workspaceCaptionAccent(ws)).toBe(resolveBrandColors(ws).primaryColor)
    }
  })

  it('still honours an explicit colors.primary override', () => {
    const ws = { colors: { primary: '#111111', accent: '#83957C' }, brand_style: { accent_color: '#E36525' } }
    expect(workspaceCaptionAccent(ws)).toBe('#111111')
  })
})
