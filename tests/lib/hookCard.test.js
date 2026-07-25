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
import {
  BUILTIN_VIDEO_TEMPLATE_IDS,
  CAPTION_POSITIONS,
  CAPTION_STYLE_IDS,
  resolveVideoTemplate,
  sanitizeVideoTemplate,
  headlineHoldSeconds,
  isCustomTemplateId,
} from '../../api/_lib/videoTemplates.js'

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

describe('wrapping — no orphaned final word', () => {
  const linesOf = (role, text) => {
    const svg = buildOverlaySvg({
      width: 1080, height: 1920,
      overlay: { role, text, x: 0.5, y: 0.2, size: 1, color: '#FFFFFF' },
      brandColor: '#E36525',
    }).toString()
    return [...svg.matchAll(/>([^<]+)<\/text>/g)].map((m) => m[1])
  }

  it('balances a two-line title instead of stranding one word', () => {
    // Greedy wrapping packed line one to the limit and dropped "work" alone.
    const lines = linesOf('title', 'Your tendons do most of the work')
    expect(lines).toHaveLength(2)
    expect(lines[1].split(/\s+/).length).toBeGreaterThan(1)
  })

  it('balances a longer headline too', () => {
    const lines = linesOf('title', 'The same reward loop that works in your nervous system')
    expect(lines.every((l) => l.split(/\s+/).length > 1)).toBe(true)
  })

  it('does not split text that fits on one line', () => {
    expect(linesOf('hook_card', 'Your tendons do most of the work')).toHaveLength(1)
  })

  it('never loses words when rebalancing', () => {
    const text = 'The same reward loop that works in your nervous system'
    expect(linesOf('title', text).join(' ')).toBe(text)
  })
})

describe('video templates — built-ins', () => {
  it('every built-in resolves to something the renderer understands', () => {
    for (const id of BUILTIN_VIDEO_TEMPLATE_IDS) {
      const t = resolveVideoTemplate(id)
      expect(CAPTION_POSITIONS).toContain(t.captions.position)
      expect(CAPTION_STYLE_IDS).toContain(t.captions.style)
      expect(t.captions.sizeScale).toBeGreaterThan(0)
      if (t.headline.role) expect(['title', 'hook_card']).toContain(t.headline.role)
    }
  })

  it('keeps its id so an existing workspace pin still resolves', () => {
    // These ids are stored in workspaces.reel_preset. Renaming one silently
    // repoints every workspace that pinned it.
    expect(BUILTIN_VIDEO_TEMPLATE_IDS.sort()).toEqual(
      ['captions_only', 'editorial', 'hook_card', 'kinetic'],
    )
  })

  it('falls back to hook_card for an unknown id rather than throwing', () => {
    expect(resolveVideoTemplate('not-a-template').id).toBe('hook_card')
    expect(resolveVideoTemplate(null).id).toBe('hook_card')
  })
})

describe('video templates — custom rows', () => {
  const customs = [{
    id: '11111111-2222-3333-4444-555555555555',
    name: 'My look',
    config: {
      headline: { role: 'hook_card', yFrac: 0.4, widthFrac: 0.7, hold: 2, fadeIn: true },
      captions: { enabled: true, position: 'center', style: 'glow', sizeScale: 1.6 },
      blocks: { headline: { fontWeight: 'extrabold', color: '#FF0000', shadow: 'strong', uppercase: true } },
    },
  }]

  it('resolves a custom row by uuid with the same shape as a built-in', () => {
    const t = resolveVideoTemplate('11111111-2222-3333-4444-555555555555', customs)
    expect(t.name).toBe('My look')
    expect(t.headline.role).toBe('hook_card')
    expect(t.headline.yFrac).toBeCloseTo(0.4)
    expect(t.captions.style).toBe('glow')
    expect(t.captions.sizeScale).toBeCloseTo(1.6)
    expect(t.blocks.headline.uppercase).toBe(true)
  })

  it('recognises a uuid as a custom id and a slug as a built-in', () => {
    expect(isCustomTemplateId('11111111-2222-3333-4444-555555555555')).toBe(true)
    expect(isCustomTemplateId('hook_card')).toBe(false)
  })

  it('sanitises a half-written config instead of failing the reel', () => {
    const t = resolveVideoTemplate('x', [{ id: 'x', name: 'Broken', config: { captions: { position: 'sideways', style: 'nope', sizeScale: 99 } } }])
    expect(CAPTION_POSITIONS).toContain(t.captions.position)
    expect(CAPTION_STYLE_IDS).toContain(t.captions.style)
    expect(t.captions.sizeScale).toBeLessThanOrEqual(2.5)
  })
})

describe('headline hold', () => {
  const t = (over = {}) => sanitizeVideoTemplate({ headline: { role: 'hook_card', ...over } })

  it('derives from reading time by default', () => {
    const short = headlineHoldSeconds(t(), 'Two words', 30)
    const long = headlineHoldSeconds(t(), 'one two three four five six seven eight', 30)
    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(3.0)
  })

  it('honours an explicit numeric hold', () => {
    expect(headlineHoldSeconds(t({ hold: 2.2 }), 'Two words', 30)).toBeCloseTo(2.2)
  })

  it('still caps at a third of the clip, even for an explicit hold', () => {
    // A template must not be able to ask for more frames than the clip has.
    expect(headlineHoldSeconds(t({ hold: 10 }), 'Two words', 3)).toBeLessThanOrEqual(3 * 0.35 + 1e-9)
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
