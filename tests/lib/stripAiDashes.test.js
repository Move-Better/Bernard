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

// The original rules 2 and 3 required an ASCII LETTER on BOTH sides, so a
// connector flanked by a digit, emoji or symbol survived; and rule 1 required a
// preceding non-space, so a string OPENING with a dash survived.
//
// Honest scope note: when this was widened, the live incidence of these gaps
// was ZERO. Across 127 recent content_items rows there were no string-start
// dashes, no digit-flanked and no symbol-flanked connectors. This is defence in
// depth against a shape the model has not happened to produce yet, not the fix
// for the reported complaint (that was the prompt contradiction + the
// unsanitized interview fan-out).
describe('stripAiDashes — connectors flanked by a digit or symbol', () => {
  it('converts a digit on the left, letter on the right', () => {
    expect(stripAiDashes('Week 1 – rest')).toBe('Week 1, rest')
    expect(stripAiDashes('2023 – a turning point')).toBe('2023, a turning point')
  })

  it('converts a letter on the left, digit on the right', () => {
    expect(stripAiDashes('rest – 3 sets')).toBe('rest, 3 sets')
  })

  it('converts an emoji/symbol flank', () => {
    expect(stripAiDashes('Book now 👆 – link in bio')).toBe('Book now 👆, link in bio')
    expect(stripAiDashes('recovery – 👆 tap here')).toBe('recovery, 👆 tap here')
  })

  it('converts a digit-flanked spaced ASCII hyphen', () => {
    expect(stripAiDashes('Week 1 - rest')).toBe('Week 1, rest')
  })
})

describe('stripAiDashes — dangling dashes at the string edges', () => {
  it('removes a leading em-dash rather than commafying it', () => {
    // ", Book now" would be worse than the tell it replaces.
    expect(stripAiDashes('— Book your assessment')).toBe('Book your assessment')
    expect(stripAiDashes('– Book your assessment')).toBe('Book your assessment')
  })

  it('removes a trailing dangling dash', () => {
    expect(stripAiDashes('Book your assessment —')).toBe('Book your assessment')
  })

  it('leaves a leading ASCII hyphen alone (that is a bullet, not a dash)', () => {
    expect(stripAiDashes('- first point')).toBe('- first point')
  })

  it('still strips a connector on a string that also opens with a dash', () => {
    expect(stripAiDashes('— the joint is fine — the pattern is not'))
      .toBe('the joint is fine, the pattern is not')
  })
})

describe('stripAiDashes — the widened rules still protect ranges and markdown', () => {
  // The one-letter rule is what makes this structural: a numeric range has a
  // digit on BOTH sides, so neither widened rule can ever match it.
  it('preserves digit-on-both-sides ranges', () => {
    expect(stripAiDashes('recovery takes 30–40 minutes')).toBe('recovery takes 30–40 minutes')
    expect(stripAiDashes('do 3 - 5 reps')).toBe('do 3 - 5 reps')
    expect(stripAiDashes('a 45–60 second script')).toBe('a 45–60 second script')
  })

  it('preserves markdown structure (no space-hyphen-space shape)', () => {
    expect(stripAiDashes('intro\n\n---\n\nbody')).toBe('intro\n\n---\n\nbody')
    expect(stripAiDashes('Takeaways:\n- first\n- second')).toBe('Takeaways:\n- first\n- second')
  })

  it('preserves in-word and hashtag hyphens', () => {
    expect(stripAiDashes('warm-up before a session #Portland-PT'))
      .toBe('warm-up before a session #Portland-PT')
  })

  it('is still idempotent across the widened rules', () => {
    const once = stripAiDashes('— Week 1 – rest, then 30–40 minutes —')
    expect(stripAiDashes(once)).toBe(once)
    expect(once).toBe('Week 1, rest, then 30–40 minutes')
  })
})
