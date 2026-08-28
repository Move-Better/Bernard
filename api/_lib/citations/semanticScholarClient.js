// api/_lib/citations/semanticScholarClient.js
//
// Semantic Scholar Graph API client — free public API, no key required (a key
// raises the rate limit but isn't needed to function; see SEMANTIC_SCHOLAR_API_KEY
// below). Real paperId + real title + real abstract + real url, never invented.
//
// Same split as pubmedClient.js: a pure `parseSearchResponse` for testability,
// and `searchSemanticScholar` for the network glue.
//
// Verified live 2026-08-27: the anonymous tier 429s under burst traffic
// ("Too Many Requests... apply for a key for higher rate limits") — this is a
// real, expected failure mode of a free public API, not a bug. searchSemanticScholar
// surfaces it as a normal thrown error so the pipeline's per-source try/catch
// (pipeline.js) treats "this source is unavailable right now" as "zero
// candidates from Semantic Scholar this run," never as a reason to fail the
// whole enrichment pass — PubMed and the web-search source are independent.

const SEARCH_URL = 'https://api.semanticscholar.org/graph/v1/paper/search'
const FIELDS = 'title,abstract,url,externalIds'

/**
 * Parse a Semantic Scholar /paper/search response body into candidates. Pure.
 * @param {object} json
 * @returns {Array<{source: 'semantic_scholar', paperId: string, title: string, abstract: string, url: string}>}
 */
export function parseSearchResponse(json) {
  const data = Array.isArray(json?.data) ? json.data : []
  return data
    .filter((p) => p?.title && p?.url) // url is the real Semantic Scholar page for this REAL paper
    .map((p) => ({
      source: 'semantic_scholar',
      paperId: p.paperId || p.externalIds?.DOI || p.url,
      title: String(p.title),
      abstract: String(p.abstract || ''),
      url: String(p.url),
    }))
}

/**
 * Search Semantic Scholar for a claim and return real candidates. Network.
 * @param {string} claimText
 * @param {{max?: number}} [opts]
 */
export async function searchSemanticScholar(claimText, { max = 5 } = {}) {
  const query = String(claimText || '').trim()
  if (!query) return []

  const headers = {}
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY

  const res = await fetch(
    `${SEARCH_URL}?query=${encodeURIComponent(query)}&limit=${Math.min(Math.max(max, 1), 20)}&fields=${FIELDS}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`semantic_scholar_${res.status}: ${body.slice(0, 160)}`)
  }
  const json = await res.json()
  return parseSearchResponse(json)
}
