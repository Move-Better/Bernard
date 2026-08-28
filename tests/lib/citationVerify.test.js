import { describe, it, expect } from 'vitest'
import { fetchCandidateContent, judgeCandidate, sourceTierFor } from '../../api/_lib/citations/verify.js'

describe('fetchCandidateContent', () => {
  it('is a pass-through for pubmed/semantic_scholar — no network call, uses the abstract already in hand', async () => {
    let fetchCalled = false
    const fakeFetch = async () => { fetchCalled = true; return { ok: true, text: async () => '' } }
    const result = await fetchCandidateContent(
      { source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'Real Title', abstract: 'a real abstract' },
      { fetchFn: fakeFetch },
    )
    expect(fetchCalled).toBe(false)
    expect(result).toEqual({ content: 'a real abstract', title: 'Real Title', fetchOk: true })
  })

  it('flags fetchOk:false for pubmed/semantic_scholar with an empty abstract', async () => {
    const result = await fetchCandidateContent({ source: 'semantic_scholar', url: 'x', title: 't', abstract: '' })
    expect(result.fetchOk).toBe(false)
  })

  it('for a web candidate, fetches the real page and extracts title + text', async () => {
    const html = '<html><head><title>Real Web Title</title></head><body><p>Real body content here.</p></body></html>'
    const fakeFetch = async () => ({ ok: true, text: async () => html })
    const result = await fetchCandidateContent({ source: 'web', url: 'https://www.mayoclinic.org/x', title: null }, { fetchFn: fakeFetch })
    expect(result.fetchOk).toBe(true)
    expect(result.title).toBe('Real Web Title')
    expect(result.content).toContain('Real body content here.')
  })

  it('a non-200 response is fetchOk:false, not a throw', async () => {
    const fakeFetch = async () => ({ ok: false, status: 404 })
    const result = await fetchCandidateContent({ source: 'web', url: 'https://www.mayoclinic.org/dead', title: null }, { fetchFn: fakeFetch })
    expect(result).toEqual({ content: '', title: null, fetchOk: false })
  })

  it('a network throw (timeout, DNS failure) is fetchOk:false, not a crash of the enrichment pass', async () => {
    const fakeFetch = async () => { throw new Error('timeout') }
    const result = await fetchCandidateContent({ source: 'web', url: 'https://www.mayoclinic.org/x', title: null }, { fetchFn: fakeFetch })
    expect(result).toEqual({ content: '', title: null, fetchOk: false })
  })
})

describe('judgeCandidate', () => {
  it('passes claim + real content to the model and parses its verdict', async () => {
    let capturedUser = null
    const fakeGenerate = async ({ messages }) => {
      capturedUser = messages[0].content
      return { text: '{"support": true, "confidence": 0.8, "why": "matches"}' }
    }
    const verdict = await judgeCandidate(
      { claimText: 'a claim', candidateTitle: 'title', candidateContent: 'the real content', sourceType: 'peer_reviewed' },
      { generateTextFn: fakeGenerate },
    )
    expect(verdict).toEqual({ support: true, confidence: 0.8, why: 'matches' })
    expect(capturedUser).toContain('the real content')
  })

  it('an unparseable model response returns null (fail closed), not a fabricated default verdict', async () => {
    const fakeGenerate = async () => ({ text: 'not json at all' })
    const verdict = await judgeCandidate(
      { claimText: 'x', candidateTitle: 'y', candidateContent: 'z', sourceType: null },
      { generateTextFn: fakeGenerate },
    )
    expect(verdict).toBe(null)
  })
})

describe('sourceTierFor', () => {
  it('resolves a tier for an allowlisted url', () => {
    expect(sourceTierFor('https://pubmed.ncbi.nlm.nih.gov/1/')).toBe('peer_reviewed')
  })
  it('returns null for a non-allowlisted or malformed url', () => {
    expect(sourceTierFor('https://random.com/x')).toBe(null)
    expect(sourceTierFor('not a url')).toBe(null)
  })
})
