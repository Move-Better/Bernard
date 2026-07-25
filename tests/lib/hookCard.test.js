import { describe, it, expect } from 'vitest'
import {
  isUsableHeadline,
  headlineWindow,
  wordCount,
  HEADLINE_MAX_WORDS,
  HEADLINE_MAX_CHARS,
} from '../../api/_lib/headlineGen.js'
import { normalizeOverlays, buildOverlaySvg } from '../../api/_lib/videoOverlays.js'
import { buildBrandOverlaySvg } from '../../api/_lib/brandRender.js'

// The real hooks from the five reels that were drafted and never published.
// Each is 149-219 chars against a band that fits ~102, so each shipped
// truncated mid-sentence. None may pass the headline gate.
const REAL_HOOKS = [
  "The reason high knees naturally want to be fast isn't a coincidence — your body is using the elastic recoil of your tendons and connective tissue to do most of the work for you.",
  'The same reward loop that works in dog training works in your nervous system — every time your brain finds something other than pain to pay attention to, that pathway gets a little more hardwired.',
  "She still has the video of the first time she got up off the floor on her own — and after eight or nine months of work, that moment hit differently than almost anything else she'd felt. She just didn't know she could.",
  'The real conversation happening in every appointment here is about being old and productive — not old and broken — and doing what you love for as long as your body will carry you there.',
  "That moment when someone realizes their body might be capable of more than they'd let themselves believe — that's not a small thing, that's everything.",
]

describe('headline gate — never truncate, drop the card instead', () => {
  it('rejects every real hook that shipped truncated', () => {
    for (const h of REAL_HOOKS) {
      expect(isUsableHeadline(h), `should reject: ${h.slice(0, 40)}…`).toBe(false)
    }
  })

  it('accepts the shortened headlines written for those same clips', () => {
    for (const h of [
      'Your tendons do most of the work',
      'Your nervous system runs on rewards',
      'The first time she stood up alone',
      'Old and productive, not old and broken',
      'More capable than she believed',
    ]) {
      expect(isUsableHeadline(h), `should accept: ${h}`).toBe(true)
    }
  })

  it(`rejects at ${HEADLINE_MAX_WORDS + 1} words and accepts at ${HEADLINE_MAX_WORDS}`, () => {
    expect(isUsableHeadline('one two three four five six seven eight')).toBe(true)
    expect(isUsableHeadline('one two three four five six seven eight nine')).toBe(false)
  })

  it('rejects a short-word-count headline that is still too wide', () => {
    // 5 words, but far past the character budget for the card.
    const wide = 'Extraordinarily uncomfortable proprioceptive recalibration protocols'
    expect(wordCount(wide)).toBeLessThanOrEqual(HEADLINE_MAX_WORDS)
    expect(wide.length).toBeGreaterThan(HEADLINE_MAX_CHARS)
    expect(isUsableHeadline(wide)).toBe(false)
  })

  it('rejects empty / whitespace', () => {
    expect(isUsableHeadline('')).toBe(false)
    expect(isUsableHeadline('   ')).toBe(false)
    expect(isUsableHeadline(null)).toBe(false)
  })
})

describe('hook-then-drop timing', () => {
  it('is on at frame 0 and off within 3s on a normal clip', () => {
    const out = headlineWindow('Your tendons do most of the work', 9)
    expect(out).toBeGreaterThan(0)
    expect(out).toBeLessThanOrEqual(3.0)
  })

  it('scales with reading time — a longer headline holds longer', () => {
    const short = headlineWindow('Two words', 30)
    const long = headlineWindow('one two three four five six seven eight', 30)
    expect(long).toBeGreaterThan(short)
  })

  it('never holds less than a readable floor', () => {
    expect(headlineWindow('Hi', 30)).toBeGreaterThanOrEqual(1.8)
  })

  it('never eats more than a third of a short clip', () => {
    const dur = 3
    expect(headlineWindow('one two three four five six seven eight', dur)).toBeLessThanOrEqual(dur * 0.35 + 1e-9)
  })
})

describe('hook_card overlay', () => {
  const card = (over = {}) => normalizeOverlays([{
    role: 'hook_card', text: 'Your tendons do most of the work',
    x: 0.5, y: 0.17, size: 1, color: '#FFFFFF', in: 0, out: 2.6, ...over,
  }], 9)

  it('survives normalizeOverlays as hook_card, not coerced to title', () => {
    const [o] = card()
    expect(o.role).toBe('hook_card')
    expect(o.in).toBe(0)
    expect(o.out).toBeCloseTo(2.6)
  })

  it('renders an inset card — not a full-bleed band', () => {
    const svg = buildOverlaySvg({ width: 1080, height: 1920, overlay: card()[0], accentColor: '#E36525' }).toString()
    const widths = [...svg.matchAll(/<rect[^>]*width="(\d+)"/g)].map((m) => +m[1])
    expect(widths.length).toBeGreaterThan(0)
    // Every rect must be inset. The bug being designed out is a rect spanning
    // the whole frame width.
    for (const w of widths) expect(w).toBeLessThan(1080)
  })

  it('paints the brand colour as a rule, not as the card fill', () => {
    const svg = buildOverlaySvg({
      width: 1080, height: 1920, overlay: card()[0], brandColor: '#E36525',
    }).toString()
    const ruleRects = [...svg.matchAll(/<rect[^>]*width="(\d+)"[^>]*fill="#E36525"/g)]
      .concat([...svg.matchAll(/<rect[^>]*fill="#E36525"[^>]*width="(\d+)"/g)])
    expect(ruleRects.length).toBeGreaterThan(0)
    // A slim rule, nowhere near the card's ~950px width.
    for (const m of ruleRects) expect(+m[1]).toBeLessThan(1080 * 0.05)
  })

  it('draws the rule in the TENANT brand colour, not the sage accent default', () => {
    // resolveBrandColors puts brand_style.accent_color into primaryColor, while
    // accentColor falls back to DEFAULT_ACCENT '#83957C'. Drawing the rule from
    // accentColor rendered sage-green on an orange-branded workspace — it looked
    // deliberate, which is exactly why this needs pinning.
    const svg = buildOverlaySvg({
      width: 1080, height: 1920, overlay: card()[0],
      accentColor: '#83957C', brandColor: '#E36525',
    }).toString()
    expect(svg).toContain('#E36525')
    expect(svg).not.toContain('#83957C')
  })

  it('keeps a 31-character headline on one line', () => {
    // "Your tendons do most of the work" wrapped with "work" orphaned on line 2
    // when the glyph-width estimate was 0.55em.
    const svg = buildOverlaySvg({ width: 1080, height: 1920, overlay: card()[0] }).toString()
    expect([...svg.matchAll(/<text /g)]).toHaveLength(1)
  })

  it('left-aligns its text', () => {
    const svg = buildOverlaySvg({ width: 1080, height: 1920, overlay: card()[0] }).toString()
    expect(svg).toContain('text-anchor="start"')
    expect(svg).not.toContain('text-anchor="middle"')
  })
})

describe('brand caption band', () => {
  const band = (captionText) => buildBrandOverlaySvg({
    width: 1080, height: 1920, captionPos: 'top', captionText,
    staffName: 'Philip Abraham III', workspaceName: 'Move Better',
    primaryColor: '#E36525', accentColor: '#E36525',
  }).toString()

  it('draws no band when there is no caption text', () => {
    // The reel factory relies on this to opt out of the band entirely.
    expect(band('')).not.toContain('#E36525" fill-opacity')
  })

  it('still draws the band when there IS caption text', () => {
    expect(band('A real caption')).toContain('#E36525')
    expect(band('A real caption')).toContain('A real caption')
  })
})
