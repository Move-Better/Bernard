import { describe, it, expect } from 'vitest'
import { parseCaptionAndSlides } from '../../api/_lib/producer/slidesBlock.js'

// The P0 (reported 2026-07-29): the regenerate path split atom output on a stale
// ---OVERLAY--- marker the prompt no longer emits, so for every Instagram piece
// the raw ---SLIDES--- separator + JSON array landed in the caption box. This
// parser is now the single source of truth shared by draftAtom.js (first draft)
// and regenerate.js. These pin the two invariants: (1) the caption NEVER retains
// the ---SLIDES--- separator or the JSON that follows it, and (2) a valid block
// parses into a normalized deck.

// The exact shape an Instagram atom emits: caption + hashtags, then the
// separator on its own line, then a JSON array (see atomPrompts.js).
const IG_OUTPUT = `Falls are preventable. Not with handrails, with training.

A simple self-test: stand on one leg, close your eyes, and count.

#fallprevention #balancetraining #MoveBetter

---SLIDES---
[
  { "template": "cover", "blocks": [{ "role": "hook", "text": "YOUR BALANCE IS TELLING YOU SOMETHING", "position": "center" }] },
  { "template": "cta", "blocks": [{ "role": "cta", "text": "Reserve Your Seat", "position": "bottom" }] }
]`

describe('parseCaptionAndSlides', () => {
  it('strips the ---SLIDES--- block (and its JSON) out of the caption — the P0', () => {
    const { caption } = parseCaptionAndSlides(IG_OUTPUT)
    // The exact regression: neither the separator nor the JSON may survive.
    expect(caption).not.toContain('---SLIDES---')
    expect(caption).not.toContain('"template"')
    expect(caption).not.toContain('[')
    expect(caption.endsWith('#MoveBetter')).toBe(true)
  })

  it('parses the block into a normalized deck', () => {
    const { slides } = parseCaptionAndSlides(IG_OUTPUT)
    expect(Array.isArray(slides)).toBe(true)
    expect(slides).toHaveLength(2)
    expect(slides[0]).toMatchObject({ photo_idx: null, template: 'cover' })
    expect(slides[0].blocks[0]).toMatchObject({ role: 'hook', position: 'center' })
    expect(slides[0].blocks[0].text).toBe('YOUR BALANCE IS TELLING YOU SOMETHING')
  })

  it('tolerates a fenced ```json block', () => {
    const out = `Caption here\n\n---SLIDES---\n\`\`\`json\n[{ "template": "cover", "blocks": [{ "role": "hook", "text": "HI" }] }]\n\`\`\``
    const { caption, slides } = parseCaptionAndSlides(out)
    expect(caption).toBe('Caption here')
    expect(slides).toHaveLength(1)
  })

  it('returns null slides (never a partial/garbage caption) when the JSON is truncated', () => {
    // Mirrors a real corrupted row whose stored content was cut off mid-JSON.
    const out = `Caption text\n\n#tag\n\n---SLIDES---\n[\n  { "template": "cover", "blocks": [{ "role": "hook", "text": "YOUR POSTURE`
    const { caption, slides } = parseCaptionAndSlides(out)
    expect(caption).toBe('Caption text\n\n#tag')
    expect(caption).not.toContain('---SLIDES---')
    expect(slides).toBeNull()
  })

  it('leaves a non-Instagram caption untouched with null slides', () => {
    const out = 'Just a LinkedIn caption, no slides here.'
    const { caption, slides } = parseCaptionAndSlides(out)
    expect(caption).toBe(out)
    expect(slides).toBeNull()
  })

  it('drops empty-text blocks and empty non-cover slides', () => {
    const out = `Cap\n\n---SLIDES---\n[
      { "template": "cover", "blocks": [{ "role": "hook", "text": "COVER" }] },
      { "template": "explainer", "blocks": [{ "role": "body", "text": "   " }] },
      { "template": "demonstration", "blocks": [] }
    ]`
    const { slides } = parseCaptionAndSlides(out)
    // cover (slide 0) kept; empty explainer dropped; demonstration kept (photo-only).
    expect(slides.map((s) => s.template)).toEqual(['cover', 'demonstration'])
  })
})
