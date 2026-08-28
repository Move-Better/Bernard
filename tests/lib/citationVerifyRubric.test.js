import { describe, it, expect } from 'vitest'
import { buildVerifyPrompt, parseVerifyResult } from '../../api/_lib/citations/verifyRubric.js'

describe('buildVerifyPrompt', () => {
  it('embeds the claim and the REAL candidate content (not a summary of it)', () => {
    const { instructions, user } = buildVerifyPrompt({
      claimText: 'imaging correlates poorly with pain',
      candidateTitle: 'MRI findings in asymptomatic adults',
      candidateContent: 'This study found disc abnormalities in 52% of asymptomatic adults...',
      sourceType: 'peer_reviewed',
    })
    expect(user).toContain('imaging correlates poorly with pain')
    expect(user).toContain('This study found disc abnormalities in 52%')
    expect(instructions).toMatch(/strict/i)
  })

  it('never instructs the judge to name a url — the instructions explicitly say not to', () => {
    const { instructions } = buildVerifyPrompt({ claimText: 'x', candidateTitle: 'y', candidateContent: 'z', sourceType: null })
    expect(instructions).toMatch(/do not include a url/i)
  })

  it('adds extra skepticism language for reputable_health_ed sources', () => {
    const { instructions } = buildVerifyPrompt({ claimText: 'x', candidateTitle: 'y', candidateContent: 'z', sourceType: 'reputable_health_ed' })
    expect(instructions).toMatch(/health-education/i)
  })

  it('handles missing/empty content without throwing', () => {
    const { user } = buildVerifyPrompt({ claimText: 'x', candidateTitle: null, candidateContent: '', sourceType: null })
    expect(user).toContain('could not fetch content')
  })
})

describe('parseVerifyResult — the load-bearing narrow parser', () => {
  it('parses a clean support:true verdict', () => {
    const raw = '{"support": true, "confidence": 0.85, "why": "The abstract directly states this finding."}'
    expect(parseVerifyResult(raw)).toEqual({ support: true, confidence: 0.85, why: 'The abstract directly states this finding.' })
  })

  it('parses a clean support:false verdict', () => {
    const raw = '{"support": false, "confidence": 0.9, "why": "This paper discusses a different condition entirely."}'
    const result = parseVerifyResult(raw)
    expect(result.support).toBe(false)
  })

  it('returns null (fail closed) for unparseable output — never defaults to support:true', () => {
    expect(parseVerifyResult('I think this probably supports it, yes.')).toBe(null)
    expect(parseVerifyResult('')).toBe(null)
    expect(parseVerifyResult(null)).toBe(null)
  })

  it('returns null when "support" is missing or not a boolean, even if the rest of the JSON is well-formed', () => {
    expect(parseVerifyResult('{"confidence": 0.9, "why": "looks good"}')).toBe(null)
    expect(parseVerifyResult('{"support": "yes", "confidence": 0.9, "why": "x"}')).toBe(null)
  })

  it('clamps confidence to [0,1] and defaults a missing/invalid confidence to 0', () => {
    expect(parseVerifyResult('{"support": true, "confidence": 5, "why": "x"}').confidence).toBe(1)
    expect(parseVerifyResult('{"support": true, "confidence": -2, "why": "x"}').confidence).toBe(0)
    expect(parseVerifyResult('{"support": true, "why": "x"}').confidence).toBe(0)
  })

  it('THE anti-fabrication guard: even if the judge output includes a "url" field, parseVerifyResult never surfaces it — the return shape has no url key at all', () => {
    const raw = '{"support": true, "confidence": 0.95, "why": "supports it", "url": "https://pubmed.ncbi.nlm.nih.gov/99999999/"}'
    const result = parseVerifyResult(raw)
    expect(result).toEqual({ support: true, confidence: 0.95, why: 'supports it' })
    expect(Object.keys(result)).not.toContain('url')
    expect(Object.keys(result).sort()).toEqual(['confidence', 'support', 'why'])
  })
})
