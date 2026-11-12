import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { wordSources, needsCloseRead } from '../../src/lib/voiceFidelity.js'

// Post editor audit B (mockup signed off 2026-11-11). Real provenance numbers
// from the Move Better blogs in that mockup.
const blog = (verbatim_pct, paraphrase_pct, synthesis_pct, verbatimBlocks = 0) => ({
  provenance: {
    summary: { verbatim_pct, paraphrase_pct, synthesis_pct, prior_corpus_pct: 0, voice_phrase_echo_count: 0 },
    blocks: [
      ...Array.from({ length: verbatimBlocks }, () => ({ source_type: 'verbatim' })),
      { source_type: 'synthesis' },
    ],
  },
})

describe('wordSources', () => {
  it('splits a blog into as said / reworded / Bernard, and counts exact phrases', () => {
    expect(wordSources(blog(87, 10, 3, 27))).toEqual({ asSaid: 87, reworded: 10, bernard: 3, prior: 0, echoes: 0, phrases: 27 })
  })
  it('returns null for a post without provenance (every social post today)', () => {
    expect(wordSources({ voice_fidelity_score: 83 })).toBeNull()
  })
})

describe('needsCloseRead', () => {
  it('flags the blog Bernard wrote 94% of', () => {
    expect(needsCloseRead(blog(0, 0, 94))).toBe(true)
  })
  it('does not flag the other blogs (3, 19, 23, 24 and 17% Bernard)', () => {
    for (const b of [blog(87, 10, 3), blog(81, 0, 19), blog(31, 46, 23), blog(30, 36, 24), blog(57, 17, 17)]) {
      expect(needsCloseRead(b)).toBe(false)
    }
  })
  it('the line is "more than 40%", not "40% or more"', () => {
    expect(needsCloseRead(blog(30, 30, 40))).toBe(false)
    expect(needsCloseRead(blog(30, 29, 41))).toBe(true)
  })
})

describe('one voice number on the editor', () => {
  const panel = readFileSync(fileURLToPath(new URL('../../src/components/story-detail/AssetsPane.jsx', import.meta.url)), 'utf8')
  const chip = readFileSync(fileURLToPath(new URL('../../src/components/editor/VoiceChip.jsx', import.meta.url)), 'utf8')
  it('the publish panel no longer shows a second voice percentage', () => {
    expect(panel).not.toMatch(/in clinician&rsquo;s voice/)
    expect(panel).not.toMatch(/model-invented/)
  })
  it('the chip shows the word sources and the close-read warning', () => {
    expect(chip).toContain('Where the words came from')
    expect(chip).toContain('Read closely')
    expect(chip).toMatch(/if \(!hasAudit && !closeRead\) return null/)
  })
})
