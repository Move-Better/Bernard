// api/_lib/citations/pipeline.js
//
// THE ORCHESTRATOR. This is where the one invariant from the spec lives
// structurally, not just as a prompt instruction:
//
//   "A research citation URL must NEVER be emitted from the model's own
//   memory/training data. Every link that ships must trace back to a real
//   API result and pass content-level verification."
//
// How that's enforced here, mechanically (read this before touching anything
// below): a citation's `url` and `title` are read ONLY from a `candidate`
// object that came out of a retrieval function (pubmedClient / semanticScholarClient /
// webSearchClient — or fetchContentFn's real-page title for web candidates).
// The judge (verify.js / verifyRubric.js) is called ONLY to produce a verdict
// — {support, confidence, why} — and this file never reads a url/title field
// off that verdict, because parseVerifyResult doesn't even define one. There
// is no variable in this function that could carry a model-invented URL into
// a citation record. See tests/lib/citationPipelineAntiFabrication.test.js,
// which proves this behaviorally: a "hallucinating" judge that tries to smuggle
// a different URL in its response has zero effect on the output.
//
// Fully dependency-injected (retrieveFns / fetchContentFn / judgeFn /
// extractClaimsFn) so the guards above are testable in milliseconds, with zero
// network, zero API keys, and fully deterministic assertions — the real
// callers (api/_routes/content-items/citations-enrich.js) wire in the real
// pubmed/semanticScholar/web clients.
//
// `subjectContext` (optional) is the SECOND axis of "does this source
// genuinely support this claim" — not fabrication (a source that's real but
// about the wrong thing). Bernard is multi-tenant across human/equine/
// small-animal workspaces sharing this one pipeline, and neither the claim
// extractor nor the judge had any concept of which population a claim was
// written for until this was added — a human PubMed study could be accepted
// as "supporting" a horse or dog claim whenever the mechanism sounded
// generically similar (see runForContentItem.js for where it's derived from
// the workspace's clinic_context, and verifyRubric.js for the hard rejection
// rule this threads into).

import { isAllowedCitationUrl } from './allowlist.js'
import { sourceTierFor } from './verify.js'

const MIN_CONTENT_LENGTH = 40 // a fetched "abstract"/page shorter than this can't genuinely support anything — reject before spending a judge call on it
const DEFAULT_MAX_CANDIDATES_PER_CLAIM = 4
const DEFAULT_MAX_CITATIONS = 3

/**
 * Run the full enrichment pass for one draft: extract claims, retrieve real
 * candidates from every configured source, verify each against its REAL
 * content, keep only allowlisted + genuinely-supporting results, cap to a
 * sparing total.
 *
 * @param {object} p
 * @param {string} p.draftBody
 * @param {string} [p.subjectContext] — a one-line description of who/what this content is about (e.g. a workspace's clinic_context: human patients vs. horses vs. dogs/cats). Threaded into BOTH claim extraction and the verify judge so a source about a different subject population is never accepted just because the mechanism sounds similar. Optional — when absent (default ''), behavior is IDENTICAL to before this parameter existed.
 * @param {(draftBody: string, subjectContext: string) => Promise<Array<{claim_text: string, quote: string}>>} p.extractClaimsFn
 * @param {Array<(claimText: string) => Promise<Array<object>>>} p.retrieveFns — one per source; each returns candidates for ONE claim. Independent failures are isolated per-source.
 * @param {(candidate: object) => Promise<{content: string, title: string|null, fetchOk: boolean}>} p.fetchContentFn
 * @param {(args: {claimText: string, candidateTitle: string, candidateContent: string, sourceType: string|null, subjectContext: string}) => Promise<{support: boolean, confidence: number, why: string}|null>} p.judgeFn
 * @param {number} [p.maxCandidatesPerClaim]
 * @param {number} [p.maxCitations]
 * @returns {Promise<{citations: Array<object>, claimsConsidered: number, rejections: Array<object>}>}
 */
export async function runCitationEnrichment({
  draftBody,
  subjectContext = '',
  extractClaimsFn,
  retrieveFns,
  fetchContentFn,
  judgeFn,
  maxCandidatesPerClaim = DEFAULT_MAX_CANDIDATES_PER_CLAIM,
  maxCitations = DEFAULT_MAX_CITATIONS,
}) {
  const claims = await extractClaimsFn(draftBody, subjectContext)
  if (!Array.isArray(claims) || claims.length === 0) {
    return { citations: [], claimsConsidered: 0, rejections: [] }
  }

  const accepted = []
  const rejections = []

  for (const claim of claims) {
    const claimText = claim.claim_text
    if (!claimText) continue

    // --- Retrieval: gather from every source, isolate per-source failures ---
    const perSourceResults = await Promise.all(
      (retrieveFns || []).map(async (retrieve) => {
        try {
          const result = await retrieve(claimText)
          return Array.isArray(result) ? result : []
        } catch (e) {
          console.error('[citations/pipeline] a retrieval source failed:', e?.message)
          return []
        }
      }),
    )
    const rawCandidates = perSourceResults.flat()

    // --- Hard allowlist gate. Applies to EVERY source uniformly, regardless
    // of what the judge will later say. A candidate that fails this is never
    // even fetched or judged. ---
    const seenUrls = new Set()
    const candidates = []
    for (const c of rawCandidates) {
      if (!c?.url || typeof c.url !== 'string') continue
      if (!isAllowedCitationUrl(c.url)) {
        rejections.push({ claim_text: claimText, url: c.url, reason: 'not_allowlisted' })
        continue
      }
      if (seenUrls.has(c.url)) continue
      seenUrls.add(c.url)
      candidates.push(c)
      if (candidates.length >= maxCandidatesPerClaim) break
    }

    // --- Content fetch + verification, per surviving candidate ---
    for (const candidate of candidates) {
      const fetched = await fetchContentFn(candidate)
      if (!fetched?.fetchOk || String(fetched.content || '').trim().length < MIN_CONTENT_LENGTH) {
        rejections.push({ claim_text: claimText, url: candidate.url, reason: 'unreachable_or_empty' })
        continue // never spend a judge call on content we couldn't actually verify
      }

      // Real title always wins if the content-fetch step found one (web
      // candidates arrive untitled from retrieval — see webSearchClient.js).
      const title = fetched.title || candidate.title || null
      const sourceType = sourceTierFor(candidate.url)

      const verdict = await judgeFn({
        claimText,
        candidateTitle: title,
        candidateContent: fetched.content,
        sourceType,
        subjectContext,
      })

      if (!verdict) {
        rejections.push({ claim_text: claimText, url: candidate.url, reason: 'judge_unparseable' })
        continue // fail closed — an unparseable judge response is NOT a pass
      }
      if (!verdict.support) {
        rejections.push({ claim_text: claimText, url: candidate.url, reason: 'not_supported', why: verdict.why })
        continue
      }

      // The citation record is built ONLY from `candidate` (retrieval-sourced
      // url/title/source) and `verdict` fields that verifyRubric.js's parser
      // defines (support/confidence/why — no url, no title). This is the
      // whole guard, written down as code rather than as a comment: there is
      // no variable named anything like `verdict.url` anywhere in this file.
      accepted.push({
        claim_text: claimText,
        quote: claim.quote || '',
        source: candidate.source,
        source_url: candidate.url,
        source_title: title,
        source_type: sourceType,
        why_match: verdict.why,
        confidence: verdict.confidence,
        verify_evidence: fetched.content.slice(0, 500),
      })
    }
  }

  // Cite sparingly: cap the TOTAL across the whole post, highest-confidence
  // first — not per-claim, per the spec's "0-3 per post, never count-filled."
  accepted.sort((a, b) => b.confidence - a.confidence)
  const citations = accepted.slice(0, maxCitations)

  return { citations, claimsConsidered: claims.length, rejections }
}
