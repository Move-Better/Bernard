import { describe, it, expect } from 'vitest'
import { slideRendersText, visibleStructure } from '../../src/lib/overlayTemplates'
import { BUILTIN_THEMES } from '../../src/lib/photoTemplates'

// feedback #519c4d75 — Philip Abraham III: uploaded, distribution-ready photos
// were being darkened at the edges by the default carousel scrim. The scrim is
// a legibility overlay for text; a photo with no text (or a deck that turned it
// off) must publish untouched. These pin the rule so it can't silently regress
// back to "always darken".

describe('slideRendersText', () => {
  it('true when any block has text', () => {
    expect(slideRendersText({ blocks: [{ role: 'hook', text: 'NOT YOUR STANDARD PROTOCOL' }] })).toBe(true)
  })

  it('false when the slide has no blocks (a bare photo)', () => {
    expect(slideRendersText({ blocks: [] })).toBe(false)
    expect(slideRendersText({})).toBe(false)
    expect(slideRendersText(null)).toBe(false)
  })

  it('false when every block is empty or whitespace-only', () => {
    expect(slideRendersText({ blocks: [{ role: 'hook', text: '' }, { role: 'body', text: '   ' }] })).toBe(false)
    expect(slideRendersText({ blocks: [{ role: 'hook' }] })).toBe(false)
  })

  it('false in ad mode even with text blocks (ad templates render a clean bg)', () => {
    expect(slideRendersText({ blocks: [{ role: 'hook', text: 'x' }] }, { mode: 'ad' })).toBe(false)
  })
})

describe('visibleStructure', () => {
  const structure = [
    { type: 'photo' },
    { type: 'overlay', color: 'rgba(0,0,0,0.30)' },
    { type: 'scrim', yFrac: 0.66 },
    { type: 'panel', color: '$ink', yFrac: 0.67 },
    { type: 'rule', color: '$accent' },
  ]
  const kinds = (s) => s.map((p) => p.type)

  it('keeps the full structure when there is text and the scrim is on', () => {
    expect(visibleStructure(structure, { hasText: true, scrimOff: false })).toBe(structure)
  })

  it('drops scrim AND overlay when the slide has no text', () => {
    expect(kinds(visibleStructure(structure, { hasText: false, scrimOff: false })))
      .toEqual(['photo', 'panel', 'rule'])
  })

  it('drops scrim AND overlay when the scrim is turned off, even with text', () => {
    expect(kinds(visibleStructure(structure, { hasText: true, scrimOff: true })))
      .toEqual(['photo', 'panel', 'rule'])
  })

  it('never drops the structural primitives (photo, panel, rule, bg, circle)', () => {
    const structural = [
      { type: 'photo' }, { type: 'panel' }, { type: 'rule' },
      { type: 'bg-linear' }, { type: 'bg-radial' }, { type: 'circle' },
    ]
    expect(visibleStructure(structural, { hasText: false, scrimOff: true })).toEqual(structural)
  })

  it('passes a non-array through untouched', () => {
    expect(visibleStructure(undefined, { hasText: false })).toBe(undefined)
  })

  it('defaults to keeping the scrim when opts are omitted (no accidental strip)', () => {
    expect(visibleStructure(structure)).toBe(structure)
  })
})

// Pin the approved 'photo-dark' values (Q sign-off 2026-08-25). This is the
// DEFAULT deck theme, so a regression here silently re-darkens every workspace's
// carousels — the exact bug Philip reported.
describe("'photo-dark' default theme scrim (approved values)", () => {
  const scrims = BUILTIN_THEMES['photo-dark'].structure.filter((p) => p.type === 'scrim')

  it('has exactly one scrim — the top-edge scrim was removed', () => {
    expect(scrims.length).toBe(1)
  })

  it('has NO scrim anchored at the top edge (yFrac 0)', () => {
    expect(scrims.some((s) => s.yFrac === 0)).toBe(false)
  })

  it('starts low (>= 0.6) and stays light (max opacity <= 0.55)', () => {
    const s = scrims[0]
    expect(s.yFrac).toBeGreaterThanOrEqual(0.6)
    const maxOpacity = Math.max(...s.stops.map(([, color]) => {
      const m = color.match(/rgba\(0,0,0,([\d.]+)\)/)
      return m ? parseFloat(m[1]) : 0
    }))
    expect(maxOpacity).toBeLessThanOrEqual(0.55)
  })

  it('a text-free slide on photo-dark renders NO darkening (just the photo)', () => {
    const visible = visibleStructure(BUILTIN_THEMES['photo-dark'].structure, { hasText: false, scrimOff: false })
    expect(visible.map((p) => p.type)).toEqual(['photo'])
  })
})
