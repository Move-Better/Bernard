import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseEsearchIds,
  parseEfetchArticles,
  pubmedUrl,
  isPubmedAbstractUrl,
  pmidFromPubmedUrl,
  fetchPubmedAbstractByPmid,
} from '../../api/_lib/citations/pubmedClient.js'

// Real fixture captured live from the actual NCBI E-utilities endpoint
// 2026-08-27 (id=42657933) — not hand-written, so the parser is proven against
// the real response shape, not an idealized one.
const readFixture = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const REAL_EFETCH_XML = readFixture('../fixtures/citations/pubmed_efetch_sample.xml')

describe('pubmed esearch id parsing', () => {
  it('extracts the idlist from a real esearch JSON shape', () => {
    const json = { esearchresult: { idlist: ['42657933', '42651129'] } }
    expect(parseEsearchIds(json)).toEqual(['42657933', '42651129'])
  })

  it('returns [] for a query with zero hits, not a throw', () => {
    expect(parseEsearchIds({ esearchresult: { idlist: [] } })).toEqual([])
    expect(parseEsearchIds({})).toEqual([])
    expect(parseEsearchIds(null)).toEqual([])
  })
})

describe('pubmed efetch article parsing (real captured fixture)', () => {
  it('parses at least one real article with a non-empty title and abstract', () => {
    const articles = parseEfetchArticles(REAL_EFETCH_XML)
    expect(articles.length).toBeGreaterThan(0)
    const first = articles[0]
    expect(first.pmid).toMatch(/^\d+$/)
    expect(first.title.length).toBeGreaterThan(10)
    expect(first.title).not.toMatch(/<[^>]+>/) // no leftover markup
    expect(first.abstract.length).toBeGreaterThan(20)
  })

  it('the pmid in the parsed article matches the id the fixture was fetched for', () => {
    const articles = parseEfetchArticles(REAL_EFETCH_XML)
    expect(articles.some((a) => a.pmid === '42657933')).toBe(true)
  })

  it('joins multi-section abstracts (BACKGROUND/METHODS/RESULTS/CONCLUSIONS) into one string', () => {
    const articles = parseEfetchArticles(REAL_EFETCH_XML)
    const withAbstract = articles.find((a) => a.abstract)
    expect(withAbstract).toBeTruthy()
    // A structured abstract should read as normal prose with no leftover tags.
    expect(withAbstract.abstract).not.toMatch(/<[^>]+>/)
  })

  it('degrades gracefully on empty/garbage XML — returns [], never throws', () => {
    expect(parseEfetchArticles('')).toEqual([])
    expect(parseEfetchArticles(null)).toEqual([])
    expect(parseEfetchArticles('<html>not pubmed xml</html>')).toEqual([])
  })

  it('a PMID with no ArticleTitle still parses (empty title) — filtering title-less articles out of the CANDIDATE list is searchPubMed\'s job, not the parser\'s', () => {
    const xml = '<PubmedArticleSet><PubmedArticle><PMID>999</PMID></PubmedArticle></PubmedArticleSet>'
    const articles = parseEfetchArticles(xml)
    expect(articles).toEqual([{ pmid: '999', title: '', abstract: '' }])
  })
})

describe('pubmedUrl — the ONLY place a pubmed source_url is constructed', () => {
  it('builds a real pubmed.ncbi.nlm.nih.gov URL from a real pmid', () => {
    expect(pubmedUrl('42657933')).toBe('https://pubmed.ncbi.nlm.nih.gov/42657933/')
  })

  it('url-encodes a pmid rather than trusting it verbatim (defense in depth)', () => {
    expect(pubmedUrl('123/../../evil')).not.toContain('../')
  })
})

// Real bug found running the shipped pipeline against real content
// (2026-08-27, .claude/mockups/citation-review-real-preview.html): a plain
// HTTP GET of a pubmed.ncbi.nlm.nih.gov abstract page returns a cookie-consent
// interstitial, not the abstract — 6/6 and 3/3 reproduced on two real posts.
describe('isPubmedAbstractUrl / pmidFromPubmedUrl — detecting the cookie-wall-affected host', () => {
  it('matches a plain pubmed.ncbi.nlm.nih.gov abstract URL with a trailing slash', () => {
    expect(isPubmedAbstractUrl('https://pubmed.ncbi.nlm.nih.gov/42657933/')).toBe(true)
    expect(pmidFromPubmedUrl('https://pubmed.ncbi.nlm.nih.gov/42657933/')).toBe('42657933')
  })

  it('matches without a trailing slash, and with a tracking query string', () => {
    expect(isPubmedAbstractUrl('https://pubmed.ncbi.nlm.nih.gov/42657933')).toBe(true)
    expect(isPubmedAbstractUrl('https://pubmed.ncbi.nlm.nih.gov/42657933/?utm_source=openai')).toBe(true)
    expect(pmidFromPubmedUrl('https://pubmed.ncbi.nlm.nih.gov/42657933/?utm_source=openai')).toBe('42657933')
  })

  it('does NOT match a pmc.ncbi.nlm.nih.gov full-text URL — that host fetches cleanly, unaffected by this bug', () => {
    expect(isPubmedAbstractUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC7304256/')).toBe(false)
    expect(pmidFromPubmedUrl('https://pmc.ncbi.nlm.nih.gov/articles/PMC7304256/')).toBe(null)
  })

  it('does not match an unrelated URL or garbage input, never throws', () => {
    expect(isPubmedAbstractUrl('https://www.mayoclinic.org/x')).toBe(false)
    expect(isPubmedAbstractUrl('not a url')).toBe(false)
    expect(isPubmedAbstractUrl(null)).toBe(false)
    expect(pmidFromPubmedUrl('not a url')).toBe(null)
  })
})

describe('fetchPubmedAbstractByPmid — real efetch call by PMID, reusing the same XML parser', () => {
  it('returns the real title/abstract for a known PMID, from a real captured efetch response', async () => {
    const fakeFetch = async (url) => {
      expect(String(url)).toContain('efetch.fcgi')
      expect(String(url)).toContain('id=42657933')
      return { ok: true, text: async () => REAL_EFETCH_XML }
    }
    const article = await fetchPubmedAbstractByPmid('42657933', { fetchFn: fakeFetch })
    expect(article.pmid).toBe('42657933')
    expect(article.title.length).toBeGreaterThan(10)
    expect(article.abstract.length).toBeGreaterThan(20)
  })

  it('returns null on a non-200 response, never throws', async () => {
    const article = await fetchPubmedAbstractByPmid('1', { fetchFn: async () => ({ ok: false, status: 500 }) })
    expect(article).toBe(null)
  })

  it('returns null on a network throw, never crashes the caller', async () => {
    const article = await fetchPubmedAbstractByPmid('1', { fetchFn: async () => { throw new Error('timeout') } })
    expect(article).toBe(null)
  })

  it('returns null for an empty/missing pmid, never calls fetch', async () => {
    let called = false
    const article = await fetchPubmedAbstractByPmid('', { fetchFn: async () => { called = true; return { ok: true, text: async () => '' } } })
    expect(article).toBe(null)
    expect(called).toBe(false)
  })
})
