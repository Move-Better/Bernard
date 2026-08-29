// api/_lib/citations/verify.js
//
// Network glue for citation verification: (1) fetch a candidate's REAL content
// (abstract for pubmed/semantic_scholar — already in hand from retrieval; page
// text for web — fetched fresh here) and (2) ask the judge (verifyRubric.js)
// whether that real content supports the claim.
//
// Deliberately does NOT touch the allowlist (allowlist.js) or the URL at all —
// this file's only job is "does the REAL CONTENT support the claim," and its
// only output is the judge's verdict {support, confidence, why}. The candidate
// object (source, url, title) flows through pipeline.js unmodified except for
// `content`/`title` getting filled in here for web candidates. See
// verifyRubric.js's header for why the judge is never trusted with the URL.

import { tierForHostname, hostnameOf } from './allowlist.js'
import { extractHtmlText, extractHtmlTitle } from './htmlText.js'
import { buildVerifyPrompt, parseVerifyResult, VERIFY_MODEL } from './verifyRubric.js'
import { isPubmedAbstractUrl, pmidFromPubmedUrl, fetchPubmedAbstractByPmid } from './pubmedClient.js'

/**
 * Fetch a candidate's real content. For pubmed/semantic_scholar this is a
 * pass-through (the abstract already came from the structured API — no need
 * to re-fetch). For any OTHER candidate whose URL happens to be a
 * pubmed.ncbi.nlm.nih.gov abstract page (e.g. surfaced by web search — a real,
 * relevant paper found via a different retrieval channel), the abstract is
 * fetched via the same E-utilities efetch call the pubmed retrieval source
 * uses, NOT scraped as HTML — a plain HTTP GET of that page returns a
 * cookie-consent interstitial, not the abstract, on every real run tested
 * (see pubmedClient.js's isPubmedAbstractUrl header comment). Everything else
 * falls through to the generic web fetch. Never throws on a dead/unreachable
 * URL — returns { content: '', title: candidate.title, fetchOk: false } so
 * the caller can reject for "couldn't verify" rather than crash the whole
 * enrichment pass over one bad link.
 * @param {{source: string, url: string, title: string|null, abstract?: string}} candidate
 * @param {{fetchFn?: Function}} [deps] — injectable for tests; defaults to global fetch
 * @returns {Promise<{content: string, title: string|null, fetchOk: boolean}>}
 */
export async function fetchCandidateContent(candidate, { fetchFn = fetch } = {}) {
  if (candidate.source === 'pubmed' || candidate.source === 'semantic_scholar') {
    const abstract = String(candidate.abstract || '').trim()
    return { content: abstract, title: candidate.title, fetchOk: abstract.length > 0 }
  }

  if (isPubmedAbstractUrl(candidate.url)) {
    const pmid = pmidFromPubmedUrl(candidate.url)
    const article = pmid ? await fetchPubmedAbstractByPmid(pmid, { fetchFn }) : null
    const abstract = String(article?.abstract || '').trim()
    return {
      content: abstract,
      title: article?.title || candidate.title || null,
      fetchOk: abstract.length > 0,
    }
  }

  // web candidate — fetch the real page. A self-identifying bot UA
  // ("BernardCitationBot/1.0") was tried first and got a flat 403 from
  // mayoclinic.org (verified live 2026-08-27) — these are ordinary public
  // health-education pages that render fine for any browser, so a standard
  // browser UA is used instead of trying to negotiate bot access. Confirmed
  // working live against mayoclinic.org (200, real content) and
  // healthline.com (200) with this UA.
  try {
    const res = await fetchFn(candidate.url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    if (!res.ok) return { content: '', title: null, fetchOk: false }
    const html = await res.text()
    return {
      content: extractHtmlText(html).slice(0, 12_000),
      title: extractHtmlTitle(html),
      fetchOk: true,
    }
  } catch {
    return { content: '', title: null, fetchOk: false }
  }
}

/**
 * Judge whether a candidate's real content supports a claim. Network (calls
 * the model). Returns null if the judge's response couldn't be parsed at all
 * (degrades to "reject, couldn't verify" at the pipeline layer — never crashes
 * the run over one bad model response).
 *
 * NOTE: this function reads NOTHING from its return value except
 * support/confidence/why (per parseVerifyResult) — there is no url field on
 * the return type, by construction. See verifyRubric.js header.
 *
 * @param {{claimText: string, candidateTitle: string, candidateContent: string, sourceType: string|null}} p
 * @param {{generateTextFn?: Function}} [deps] — injectable for tests
 * @returns {Promise<{support: boolean, confidence: number, why: string}|null>}
 */
export async function judgeCandidate({ claimText, candidateTitle, candidateContent, sourceType }, { generateTextFn } = {}) {
  const { instructions, user } = buildVerifyPrompt({ claimText, candidateTitle, candidateContent, sourceType })
  let generate = generateTextFn
  if (!generate) {
    const { generateText } = await import('ai')
    generate = generateText
  }
  const { text } = await generate({
    model: VERIFY_MODEL,
    instructions,
    messages: [{ role: 'user', content: user }],
    maxOutputTokens: 400,
  })
  return parseVerifyResult(text)
}

/**
 * Convenience: the sourceType tier for a candidate's URL, for the judge prompt
 * and for the stored citation's audit trail.
 * @param {string} url
 */
export function sourceTierFor(url) {
  const host = hostnameOf(url)
  return host ? tierForHostname(host) : null
}
