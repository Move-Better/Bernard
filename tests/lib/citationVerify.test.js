import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { fetchCandidateContent, judgeCandidate, sourceTierFor } from '../../api/_lib/citations/verify.js'

const readFixture = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const REAL_EFETCH_XML = readFixture('../fixtures/citations/pubmed_efetch_sample.xml')

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

  // Real bug found running the shipped pipeline against real content
  // (2026-08-27) — a web-sourced candidate can carry a real pubmed abstract
  // URL (surfaced by web search, not the PubMed retrieval source), and a
  // plain HTTP GET of that page returns a cookie-consent interstitial, not
  // the abstract. Fixed by fetching via the same E-utilities efetch call the
  // pubmed source uses, regardless of which retrieveFn surfaced the URL.
  it('for a web-sourced candidate whose url IS a pubmed abstract page, fetches the REAL abstract via efetch — never scrapes the HTML page', async () => {
    let calledUrl = null
    const fakeFetch = async (url) => {
      calledUrl = String(url)
      if (calledUrl.includes('efetch.fcgi')) {
        return { ok: true, text: async () => REAL_EFETCH_XML }
      }
      // if this were ever called on the abstract page itself, that IS the bug
      return { ok: true, text: async () => '<html><body>Please accept cookies to continue using this site.</body></html>' }
    }
    const result = await fetchCandidateContent(
      { source: 'web', url: 'https://pubmed.ncbi.nlm.nih.gov/42657933/', title: null },
      { fetchFn: fakeFetch },
    )
    expect(calledUrl).toContain('efetch.fcgi')
    expect(calledUrl).not.toBe('https://pubmed.ncbi.nlm.nih.gov/42657933/')
    expect(result.fetchOk).toBe(true)
    expect(result.content).not.toMatch(/cookies/i)
    expect(result.content.length).toBeGreaterThan(20)
    expect(result.title.length).toBeGreaterThan(10)
  })

  it('the pubmed-abstract-URL detection is independent of a trailing slash or a tracking query string', async () => {
    const fakeFetch = async () => ({ ok: true, text: async () => REAL_EFETCH_XML })
    const a = await fetchCandidateContent({ source: 'web', url: 'https://pubmed.ncbi.nlm.nih.gov/42657933', title: null }, { fetchFn: fakeFetch })
    const b = await fetchCandidateContent({ source: 'web', url: 'https://pubmed.ncbi.nlm.nih.gov/42657933/?utm_source=openai', title: null }, { fetchFn: fakeFetch })
    expect(a.fetchOk).toBe(true)
    expect(b.fetchOk).toBe(true)
  })

  it('a pmc.ncbi.nlm.nih.gov full-text URL is unaffected — still goes through the generic web fetch, not efetch', async () => {
    const html = '<html><head><title>PMC Real Title</title></head><body><p>Real full-text content here.</p></body></html>'
    const fakeFetch = async (url) => {
      expect(String(url)).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC7304256/')
      return { ok: true, text: async () => html }
    }
    const result = await fetchCandidateContent({ source: 'web', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7304256/', title: null }, { fetchFn: fakeFetch })
    expect(result.title).toBe('PMC Real Title')
    expect(result.content).toContain('Real full-text content here.')
  })

  it('falls back to fetchOk:false (not a crash) when the pmid lookup returns nothing usable', async () => {
    const fakeFetch = async () => ({ ok: true, text: async () => '<PubmedArticleSet></PubmedArticleSet>' })
    const result = await fetchCandidateContent({ source: 'web', url: 'https://pubmed.ncbi.nlm.nih.gov/999999999/', title: null }, { fetchFn: fakeFetch })
    expect(result.fetchOk).toBe(false)
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
