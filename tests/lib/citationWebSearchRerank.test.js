import { describe, it, expect } from 'vitest'
import { rerankToAllowlist, stripTrackingParams } from '../../api/_lib/citations/webSearchClient.js'

describe('web search rerankToAllowlist — the "restricted to the allowlist" enforcement', () => {
  it('drops every URL not on the allowlist, keeps the ones that are', () => {
    const urls = [
      'https://www.mayoclinic.org/diseases-conditions/x',
      'https://some-random-blog.com/opinion-piece',
      'https://www.acatoday.org/patients/x',
      'https://a-competitor-clinic.com/blog',
    ]
    expect(rerankToAllowlist(urls)).toEqual([
      'https://www.mayoclinic.org/diseases-conditions/x',
      'https://www.acatoday.org/patients/x',
    ])
  })

  it('dedupes repeated URLs', () => {
    const urls = ['https://www.mayoclinic.org/a', 'https://www.mayoclinic.org/a']
    expect(rerankToAllowlist(urls)).toEqual(['https://www.mayoclinic.org/a'])
  })

  it('caps to max', () => {
    const urls = [
      'https://www.mayoclinic.org/a',
      'https://www.clevelandclinic.org/b',
      'https://www.nih.gov/c',
      'https://www.acatoday.org/d',
    ]
    expect(rerankToAllowlist(urls, { max: 2 })).toHaveLength(2)
  })

  it('returns [] for empty/garbage input, never throws', () => {
    expect(rerankToAllowlist([])).toEqual([])
    expect(rerankToAllowlist(null)).toEqual([])
    expect(rerankToAllowlist([null, undefined, 42, ''])).toEqual([])
  })

  it('if EVERY cited url is off-allowlist, the result is empty — the web source can legitimately return nothing', () => {
    expect(rerankToAllowlist(['https://random-site.com/a', 'https://other.com/b'])).toEqual([])
  })
})

// Real finding from running the shipped pipeline against real content
// (2026-08-27): every url_citation annotation from the OpenAI web_search tool
// carries a ?utm_source=openai tracking param — stripped before a citation is
// ever stored or shown, per .claude/mockups/citation-review-real-preview.html's
// "separately noticed" finding.
describe('stripTrackingParams — utm_* removed before a citation URL is ever stored', () => {
  it('strips the utm_source=openai param the web_search tool appends', () => {
    expect(stripTrackingParams('https://www.mayoclinic.org/a?utm_source=openai')).toBe('https://www.mayoclinic.org/a')
  })

  it('strips multiple utm_* params, case-insensitively, leaves non-utm params alone', () => {
    expect(stripTrackingParams('https://www.mayoclinic.org/a?id=5&utm_source=openai&UTM_Medium=x')).toBe('https://www.mayoclinic.org/a?id=5')
  })

  it('leaves a URL with no tracking params unchanged', () => {
    expect(stripTrackingParams('https://www.mayoclinic.org/a?id=5')).toBe('https://www.mayoclinic.org/a?id=5')
  })

  it('returns the input unchanged for an unparseable URL, never throws', () => {
    expect(stripTrackingParams('not a url')).toBe('not a url')
    expect(stripTrackingParams('')).toBe('')
  })

  it('two annotations that differ only by a tracking param dedupe correctly once stripped', () => {
    const urls = [
      'https://www.mayoclinic.org/a?utm_source=openai',
      'https://www.mayoclinic.org/a?utm_source=openai&utm_medium=chat',
    ].map(stripTrackingParams)
    expect(rerankToAllowlist(urls)).toEqual(['https://www.mayoclinic.org/a'])
  })
})
