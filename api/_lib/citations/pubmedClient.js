// api/_lib/citations/pubmedClient.js
//
// PubMed E-utilities client (esearch → efetch), free/no-key public API. Real
// PMIDs + real titles + real abstracts, never invented. Every returned
// candidate carries the source_url built from the REAL pmid the API returned —
// the model/judge never gets a chance to name a URL (see pipeline.js).
//
// Two layers, split for testability:
//   - parseEsearchIds / parseEfetchArticles: pure XML/JSON parsing, unit-tested
//     against captured fixtures — no network needed to test the parsing.
//   - searchPubMed: the network glue (esearch then efetch), a thin composition
//     of the two.
//
// Verified live 2026-08-27 against the real NCBI endpoint (no API key needed
// for this call volume; NCBI asks for an email/tool identifier in courtesy,
// not auth).

const ESEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'
const EFETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'

const TOOL_PARAMS = 'tool=bernard-citations&email=engineering@movebetter.co'

/**
 * Parse an esearch JSON response into a list of PMIDs. Pure.
 * @param {object} json — parsed esearch response body
 * @returns {string[]}
 */
export function parseEsearchIds(json) {
  const ids = json?.esearchresult?.idlist
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : []
}

/**
 * Parse an efetch XML (PubmedArticleSet) response into structured articles.
 * Pure — string in, array out, no network. Deliberately tolerant: a PMID with
 * no abstract still comes back (title-only), never thrown away — the verify
 * step will reject it for lack of content, which is the right layer for that
 * decision, not the parser.
 * @param {string} xml
 * @returns {Array<{pmid: string, title: string, abstract: string}>}
 */
export function parseEfetchArticles(xml) {
  if (!xml || typeof xml !== 'string') return []
  const articles = []
  const articleRe = /<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g
  const matches = xml.match(articleRe) || []
  for (const block of matches) {
    const pmid = (block.match(/<PMID[^>]*>(\d+)<\/PMID>/) || [])[1]
    if (!pmid) continue
    const title = decodeXmlEntities(
      (block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/) || [])[1] || '',
    ).replace(/<[^>]+>/g, '').trim()
    // AbstractText may be split into multiple labeled sections (BACKGROUND,
    // METHODS, RESULTS, CONCLUSIONS) — join them in document order.
    const abstractParts = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => decodeXmlEntities(m[1]).replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
    const abstract = abstractParts.join(' ')
    articles.push({ pmid, title, abstract })
  }
  return articles
}

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

/**
 * Build a real PubMed URL from a REAL pmid. The only place a pubmed source_url
 * is ever constructed — always derived from an id the API itself returned,
 * never from model output.
 * @param {string} pmid
 */
export function pubmedUrl(pmid) {
  return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`
}

// A real, currently-live bug found by running the shipped pipeline against
// real content (2026-08-27, see .claude/mockups/citation-review-real-preview.html):
// fetching a pubmed.ncbi.nlm.nih.gov ABSTRACT PAGE with a plain HTTP GET (the
// generic web-fetch path in verify.js) returns a cookie-consent interstitial,
// not the abstract — reproduced 6/6 and 3/3 on two real posts. This is a
// retrieval COVERAGE bug, not a fabrication-safety bug: the judge correctly
// rejects the interstitial ("just a cookie/login error page"), so real,
// relevant papers were being silently lost. A pmc.ncbi.nlm.nih.gov full-text
// URL is unaffected (fetches cleanly) — this only applies to the abstract
// host.
const PUBMED_ABSTRACT_URL_RE = /^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?(?:[?#].*)?$/i

/**
 * Does this URL point at a pubmed.ncbi.nlm.nih.gov ABSTRACT page (as opposed
 * to e.g. a pmc.ncbi.nlm.nih.gov full-text URL, which fetches fine)? Pure.
 * @param {string} url
 * @returns {boolean}
 */
export function isPubmedAbstractUrl(url) {
  return PUBMED_ABSTRACT_URL_RE.test(String(url || ''))
}

/**
 * Extract the real PMID from a pubmed.ncbi.nlm.nih.gov abstract URL, or null
 * if it doesn't match. Pure.
 * @param {string} url
 * @returns {string|null}
 */
export function pmidFromPubmedUrl(url) {
  const m = PUBMED_ABSTRACT_URL_RE.exec(String(url || ''))
  return m ? m[1] : null
}

/**
 * Fetch ONE article's real title/abstract via the same E-utilities efetch
 * call searchPubMed uses, given only a PMID — for a candidate that arrived
 * via a DIFFERENT retrieval path (e.g. web search surfacing a real
 * pubmed.ncbi.nlm.nih.gov/<pmid>/ URL) but whose abstract page can't be
 * scraped directly (see isPubmedAbstractUrl's header comment). Network.
 * Never throws on a bad/unknown PMID — returns null so the caller can treat
 * it as "couldn't verify" rather than crash the enrichment pass.
 * @param {string} pmid
 * @param {{fetchFn?: Function}} [deps] — injectable for tests; defaults to global fetch
 * @returns {Promise<{pmid: string, title: string, abstract: string}|null>}
 */
export async function fetchPubmedAbstractByPmid(pmid, { fetchFn = fetch } = {}) {
  const id = String(pmid || '').trim()
  if (!id) return null
  try {
    const res = await fetchFn(
      `${EFETCH_URL}?db=pubmed&rettype=abstract&retmode=xml&id=${encodeURIComponent(id)}&${TOOL_PARAMS}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) return null
    const xml = await res.text()
    const articles = parseEfetchArticles(xml)
    return articles.find((a) => a.pmid === id) || articles[0] || null
  } catch {
    return null
  }
}

/**
 * Search PubMed for a claim and return real candidates (esearch → efetch).
 * Network. Timed out generously but bounded — this runs inside a background
 * enrichment pass, not a user-facing request.
 * @param {string} claimText
 * @param {{max?: number}} [opts]
 * @returns {Promise<Array<{source: 'pubmed', pmid: string, title: string, abstract: string, url: string}>>}
 */
export async function searchPubMed(claimText, { max = 5 } = {}) {
  const query = String(claimText || '').trim()
  if (!query) return []

  const esearchRes = await fetch(
    `${ESEARCH_URL}?db=pubmed&retmode=json&sort=relevance&retmax=${Math.min(Math.max(max, 1), 20)}` +
    `&term=${encodeURIComponent(query)}&${TOOL_PARAMS}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!esearchRes.ok) {
    throw new Error(`pubmed_esearch_${esearchRes.status}`)
  }
  const esearchJson = await esearchRes.json()
  const pmids = parseEsearchIds(esearchJson)
  if (pmids.length === 0) return []

  const efetchRes = await fetch(
    `${EFETCH_URL}?db=pubmed&rettype=abstract&retmode=xml&id=${pmids.join(',')}&${TOOL_PARAMS}`,
    { signal: AbortSignal.timeout(15_000) },
  )
  if (!efetchRes.ok) {
    throw new Error(`pubmed_efetch_${efetchRes.status}`)
  }
  const xml = await efetchRes.text()
  const articles = parseEfetchArticles(xml)

  return articles
    .filter((a) => a.title) // a PMID with no title at all is unusable as a candidate
    .map((a) => ({
      source: 'pubmed',
      pmid: a.pmid,
      title: a.title,
      abstract: a.abstract || '',
      url: pubmedUrl(a.pmid),
    }))
}
