// Pure-function coverage for the moment-bank extraction pipeline
// (api/_lib/momentExtract.js). The verbatim locator is the fabrication guard
// behind the one-source-anchor decision — a moment whose excerpt can't be
// found character-exactly in the transcript must be dropped, and a located
// excerpt must be the EXACT on-disk slice (anchor slices back to it).

import { describe, it, expect } from 'vitest'
import { clinicianTurns, locateExcerpt, cosineSim, sanitizeProposals } from '../../api/_lib/momentExtract.js'

describe('clinicianTurns', () => {
  it('keeps only non-empty user turns, preserving raw message indices', () => {
    const messages = [
      { role: 'assistant', content: 'Tell me about knees.' },
      { role: 'user', content: 'Knees love load.' },
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'Go on.' },
      { role: 'user', content: 'Load them gradually.' },
      { role: 'user', content: 42 }, // non-string content — dropped
    ]
    expect(clinicianTurns(messages)).toEqual([
      { msgIdx: 1, content: 'Knees love load.' },
      { msgIdx: 4, content: 'Load them gradually.' },
    ])
  })

  it('returns [] for non-array input', () => {
    expect(clinicianTurns(null)).toEqual([])
    expect(clinicianTurns('nope')).toEqual([])
  })
})

describe('locateExcerpt', () => {
  const content = 'So here’s the thing about sciatica —\nit isn’t  the disc.\nMotion is lotion, always.'

  it('locates a direct verbatim excerpt and the anchor slices back to it', () => {
    const loc = locateExcerpt(content, 'Motion is lotion, always.')
    expect(loc).not.toBeNull()
    expect(content.slice(loc.char_start, loc.char_end)).toBe('Motion is lotion, always.')
    expect(loc.exact).toBe('Motion is lotion, always.')
  })

  it('tolerates whitespace differences but returns the exact on-disk slice', () => {
    // Model collapsed the newline + double space into single spaces.
    const loc = locateExcerpt(content, 'about sciatica — it isn’t the disc.')
    expect(loc).not.toBeNull()
    expect(loc.exact).toBe(content.slice(loc.char_start, loc.char_end))
    expect(loc.exact).toContain('isn’t')
    expect(loc.exact.startsWith('about sciatica')).toBe(true)
  })

  it('tolerates straight-vs-curly quote drift, still slicing the raw text', () => {
    const loc = locateExcerpt(content, "it isn't the disc.")
    expect(loc).not.toBeNull()
    // Stored excerpt is the transcript's own curly-quote characters.
    expect(loc.exact).toBe(content.slice(loc.char_start, loc.char_end))
    expect(loc.exact).toContain('isn’t')
  })

  it('returns null for paraphrased text (the fabrication guard)', () => {
    expect(locateExcerpt(content, 'Sciatica is not caused by the disc.')).toBeNull()
  })

  it('returns null for empty or non-string input', () => {
    expect(locateExcerpt(content, '')).toBeNull()
    expect(locateExcerpt(content, '   ')).toBeNull()
    expect(locateExcerpt(null, 'x')).toBeNull()
  })
})

describe('sanitizeProposals', () => {
  const good = 'x'.repeat(80)

  it('drops an oversized excerpt without failing the batch (the first-backfill bug)', () => {
    const out = sanitizeProposals([
      { turn: 0, excerpt: 'y'.repeat(2000), hook: 'h', why_it_stands_alone: 'w' },
      { turn: 1, excerpt: good, hook: 'h', why_it_stands_alone: 'w' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].turn).toBe(1)
  })

  it('drops too-short excerpts and clamps hook/why/tags instead of erroring', () => {
    const out = sanitizeProposals([
      { turn: 0, excerpt: 'short', hook: 'h', why_it_stands_alone: 'w' },
      { turn: 2, excerpt: good, hook: 'H'.repeat(500), why_it_stands_alone: 'W'.repeat(900), tags: ['a', '', 'b'.repeat(90), 'c', 'd', 'e', 'f', 'g'] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].hook.length).toBeLessThanOrEqual(120)
    expect(out[0].why_it_stands_alone.length).toBeLessThanOrEqual(300)
    expect(out[0].tags).toHaveLength(6)
    expect(out[0].tags.every((t) => t.length <= 40)).toBe(true)
  })

  it('caps the batch at 24 proposals and tolerates junk input', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ turn: i, excerpt: good, hook: 'h', why_it_stands_alone: 'w' }))
    expect(sanitizeProposals(many)).toHaveLength(24)
    expect(sanitizeProposals(null)).toEqual([])
    expect(sanitizeProposals([{ turn: -3, excerpt: good }])[0].turn).toBe(0)
  })
})

describe('cosineSim', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1)
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('is 0 for mismatched or degenerate input rather than NaN', () => {
    expect(cosineSim([1, 2], [1, 2, 3])).toBe(0)
    expect(cosineSim([0, 0], [1, 2])).toBe(0)
    expect(cosineSim(null, [1])).toBe(0)
  })
})
