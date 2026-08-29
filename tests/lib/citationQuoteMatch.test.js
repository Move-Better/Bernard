import { describe, it, expect } from 'vitest'
import { findExactQuoteSpan, willInlineLink } from '../../api/_lib/citations/quoteMatch.js'

describe('findExactQuoteSpan', () => {
  it('finds a single exact occurrence and returns its start index', () => {
    const body = 'Before. The exact sentence here. After.'
    const { count, index } = findExactQuoteSpan(body, 'The exact sentence here.')
    expect(count).toBe(1)
    expect(index).toBe(body.indexOf('The exact sentence here.'))
  })

  it('is case-sensitive — a case-mismatched quote does not count as a match', () => {
    const body = 'The Exact Sentence Here.'
    expect(findExactQuoteSpan(body, 'the exact sentence here.')).toEqual({ count: 0, index: -1 })
  })

  it('does not partially/fuzzy match — a substring of the quote with different punctuation does not count', () => {
    const body = 'Imaging correlates poorly with reported pain levels, generally speaking.'
    expect(findExactQuoteSpan(body, 'imaging correlates poorly with pain')).toEqual({ count: 0, index: -1 })
  })

  it('counts more than one occurrence as ambiguous, not a match', () => {
    const body = 'rest is not always best. Later: rest is not always best.'
    const { count } = findExactQuoteSpan(body, 'rest is not always best')
    expect(count).toBe(2)
  })

  it('returns count 0 for an empty/missing quote, never throws', () => {
    expect(findExactQuoteSpan('some body', '')).toEqual({ count: 0, index: -1 })
    expect(findExactQuoteSpan('some body', null)).toEqual({ count: 0, index: -1 })
    expect(findExactQuoteSpan('some body', undefined)).toEqual({ count: 0, index: -1 })
  })

  it('trims the quote before matching (defensive against captured trailing whitespace)', () => {
    const body = 'The claim sentence sits here.'
    expect(findExactQuoteSpan(body, '  The claim sentence sits here.  ').count).toBe(1)
  })
})

describe('willInlineLink', () => {
  it('true only for an exact, single occurrence', () => {
    expect(willInlineLink('Only here once.', 'here once')).toBe(true)
  })

  it('false when the quote is not found at all (body was hand-edited since enrichment)', () => {
    expect(willInlineLink('The body changed completely.', 'the original claim wording')).toBe(false)
  })

  it('false when the quote appears more than once (ambiguous — never guess)', () => {
    expect(willInlineLink('twice here. twice here.', 'twice here')).toBe(false)
  })
})
