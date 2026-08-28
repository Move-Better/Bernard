import { describe, it, expect } from 'vitest'
import { buildClaimExtractionPrompt, parseClaimExtractionResult, extractClaims } from '../../api/_lib/citations/claimExtraction.js'

describe('buildClaimExtractionPrompt', () => {
  it('returns instructions + user, and includes the draft body in the user message', () => {
    const { instructions, user } = buildClaimExtractionPrompt('Some blog post about disc herniation.')
    expect(instructions).toMatch(/JSON/)
    expect(instructions).toMatch(/personal anecdote/i)
    expect(user).toContain('Some blog post about disc herniation.')
  })

  it('truncates a very long draft rather than blowing the token budget', () => {
    const long = 'x'.repeat(20000)
    const { user } = buildClaimExtractionPrompt(long)
    expect(user.length).toBeLessThan(20000)
  })
})

describe('parseClaimExtractionResult', () => {
  it('parses a clean JSON list of claims', () => {
    const raw = '{"claims":[{"claim_text":"imaging correlates poorly with pain","quote":"scans don\'t tell the whole story"}]}'
    const claims = parseClaimExtractionResult(raw)
    expect(claims).toEqual([{ claim_text: 'imaging correlates poorly with pain', quote: "scans don't tell the whole story" }])
  })

  it('returns [] (not a throw) when the model returns nothing citable', () => {
    expect(parseClaimExtractionResult('{"claims":[]}')).toEqual([])
  })

  it('returns [] for unparseable model output — degrades, never crashes the run', () => {
    expect(parseClaimExtractionResult('I could not find any claims worth citing.')).toEqual([])
    expect(parseClaimExtractionResult('')).toEqual([])
    expect(parseClaimExtractionResult(null)).toEqual([])
  })

  it('drops a claim entry missing claim_text', () => {
    const raw = '{"claims":[{"quote":"no claim_text here"},{"claim_text":"real one","quote":"q"}]}'
    expect(parseClaimExtractionResult(raw)).toEqual([{ claim_text: 'real one', quote: 'q' }])
  })

  it('caps to 3 claims even if the model returns more', () => {
    const raw = JSON.stringify({
      claims: [1, 2, 3, 4, 5].map((n) => ({ claim_text: `claim ${n}`, quote: `q${n}` })),
    })
    expect(parseClaimExtractionResult(raw)).toHaveLength(3)
  })

  it('tolerates a missing quote field', () => {
    const raw = '{"claims":[{"claim_text":"a claim"}]}'
    expect(parseClaimExtractionResult(raw)).toEqual([{ claim_text: 'a claim', quote: '' }])
  })
})

describe('extractClaims (network glue, injectable)', () => {
  it('calls the injected generateTextFn with the built prompt and parses its result', async () => {
    let capturedArgs = null
    const fakeGenerate = async (args) => {
      capturedArgs = args
      return { text: '{"claims":[{"claim_text":"test claim","quote":"test quote"}]}' }
    }
    const claims = await extractClaims('a draft body', { generateTextFn: fakeGenerate })
    expect(claims).toEqual([{ claim_text: 'test claim', quote: 'test quote' }])
    expect(capturedArgs.messages[0].content).toContain('a draft body')
  })

  it('returns [] for an empty draft body without calling the model at all', async () => {
    let called = false
    const fakeGenerate = async () => { called = true; return { text: '{"claims":[]}' } }
    const claims = await extractClaims('', { generateTextFn: fakeGenerate })
    expect(claims).toEqual([])
    expect(called).toBe(false)
  })
})
