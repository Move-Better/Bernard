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
