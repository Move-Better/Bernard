import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEsearchIds, parseEfetchArticles, pubmedUrl } from '../../api/_lib/citations/pubmedClient.js'

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
