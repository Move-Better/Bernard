import { describe, it, expect } from 'vitest'
import { stripAiDashes } from '../../api/_lib/stripAiDashes.js'

describe('stripAiDashes — connector dashes become commas', () => {
  it('replaces a spaced em-dash inside a CTA (the reported tell)', () => {
    expect(stripAiDashes('Book your assessment — link in bio 👆'))
      .toBe('Book your assessment, link in bio 👆')
  })

  it('replaces a spaced em-dash joining two clauses', () => {
    expect(stripAiDashes("But the structure isn't the problem — the pattern that stressed it is."))
      .toBe("But the structure isn't the problem, the pattern that stressed it is.")
  })

  it('replaces a tight (unspaced) em-dash', () => {
    expect(stripAiDashes('assessment—link')).toBe('assessment, link')
  })

  it('replaces an en-dash between words', () => {
    expect(stripAiDashes('neighbor–to–neighbor')).toBe('neighbor, to, neighbor')
  })

  it('replaces a spaced ASCII hyphen used as a connector', () => {
    expect(stripAiDashes('book now - link in bio')).toBe('book now, link in bio')
  })

  it('handles multiple connectors in one string', () => {
    expect(stripAiDashes('one — two — three')).toBe('one, two, three')
  })
})

describe('stripAiDashes — leaves legitimate dashes/hyphens alone', () => {
  it('keeps an in-word hyphen', () => {
    expect(stripAiDashes('warm-up before a session')).toBe('warm-up before a session')
  })

  it('keeps a hashtag hyphen', () => {
    expect(stripAiDashes('Book today #Portland-PT')).toBe('Book today #Portland-PT')
  })

  it('keeps a numeric en-dash range', () => {
    expect(stripAiDashes('recovery takes 30–40 minutes')).toBe('recovery takes 30–40 minutes')
  })

  it('keeps a spaced hyphen between numbers', () => {
    expect(stripAiDashes('do 3 - 5 reps')).toBe('do 3 - 5 reps')
  })

  it('is a no-op on text with no connector dashes', () => {
    expect(stripAiDashes('A clean caption. No tells here.'))
      .toBe('A clean caption. No tells here.')
  })

  it('is idempotent', () => {
    const once = stripAiDashes('Book your assessment — link in bio')
    expect(stripAiDashes(once)).toBe(once)
  })

  it('handles non-string input safely', () => {
    expect(stripAiDashes(null)).toBe(null)
    expect(stripAiDashes(undefined)).toBe(undefined)
    expect(stripAiDashes('')).toBe('')
  })
})
