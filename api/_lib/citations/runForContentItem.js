// api/_lib/citations/runForContentItem.js
//
// Wires the REAL retrieval/verify/claim-extraction functions into the pure
// orchestrator (pipeline.js) and persists the result as `suggested` rows on
// blog_citations for one content_item. This is the single function called by
// BOTH:
//   - the on-demand endpoint (api/_routes/content-items/citations-enrich.js),
//     and
//   - the automatic post-draft hookpoints (Phase 4 — called via waitUntil
//     right after a blog/series draft is created, from the generation
//     handlers themselves, NOT as a second HTTP round trip).
//
// So the wiring only needs to exist once. Everything network/model-touching
// lives behind the dependency-injected pipeline.js — this file's only new
// responsibility is "read the draft, run the pipeline with real deps, write
// the rows."

import { runCitationEnrichment } from './pipeline.js'
import { extractClaims } from './claimExtraction.js'
import { searchPubMed } from './pubmedClient.js'
import { searchSemanticScholar } from './semanticScholarClient.js'
import { searchWebAllowlisted } from './webSearchClient.js'
import { fetchCandidateContent, judgeCandidate } from './verify.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Blog/series-part content only, per the spec's scope boundary. Series parts
// are platform:'blog' with series_id set (see split-into-series.js), so a
// plain platform check covers both without a special case.
export function isCitationEligiblePlatform(platform) {
  return platform === 'blog'
}

/**
 * Run enrichment for one content_item and persist any newly-accepted
 * citations as 'suggested' rows. Idempotent-ish: never re-proposes a
 * source_url already on record for this piece (suggested, approved, OR
 * rejected) — a human's rejection of a source sticks even across a re-run of
 * "find supporting research."
 *
 * @param {{workspaceId: string, contentItemId: string}} p
 * @returns {Promise<{ran: boolean, inserted: number, claimsConsidered: number, reason?: string}>}
 */
export async function runCitationEnrichmentForContentItem({ workspaceId, contentItemId }) {
  const itemRes = await sb(
    `content_items?id=eq.${encodeURIComponent(contentItemId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&select=id,content,platform&limit=1`,
  )
  if (!itemRes.ok) {
    console.error(`[citations/runForContentItem] draft fetch failed ${itemRes.status}`)
    return { ran: false, inserted: 0, claimsConsidered: 0, reason: 'draft_fetch_failed' }
  }
  const rows = await itemRes.json()
  const item = rows?.[0]
  if (!item) return { ran: false, inserted: 0, claimsConsidered: 0, reason: 'draft_not_found' }
  if (!isCitationEligiblePlatform(item.platform)) {
    return { ran: false, inserted: 0, claimsConsidered: 0, reason: 'not_a_blog' }
  }
  const draftBody = String(item.content || '')
  if (!draftBody.trim()) {
    return { ran: false, inserted: 0, claimsConsidered: 0, reason: 'empty_draft' }
  }

  const result = await runCitationEnrichment({
    draftBody,
    extractClaimsFn: (body) => extractClaims(body),
    retrieveFns: [
      (claimText) => searchPubMed(claimText, { max: 4 }),
      (claimText) => searchSemanticScholar(claimText, { max: 4 }).catch((e) => {
        console.error('[citations/runForContentItem] semantic scholar failed:', e?.message)
        return []
      }),
      (claimText) => searchWebAllowlisted(claimText, { max: 4 }),
    ],
    fetchContentFn: (candidate) => fetchCandidateContent(candidate),
    judgeFn: (args) => judgeCandidate(args),
  })

  if (result.citations.length === 0) {
    return { ran: true, inserted: 0, claimsConsidered: result.claimsConsidered }
  }

  // Never re-propose a source_url already on record for this piece — a prior
  // suggestion (accepted, rejected, or still pending) is a decision that
  // sticks. The unique index (content_item_id, source_url) backs this up at
  // the DB layer too, so a race between two enrichment runs can't double-insert.
  const existingRes = await sb(
    `blog_citations?content_item_id=eq.${encodeURIComponent(contentItemId)}&select=source_url`,
  )
  const existingUrls = new Set(existingRes.ok ? (await existingRes.json()).map((r) => r.source_url) : [])

  const toInsert = result.citations
    .filter((c) => !existingUrls.has(c.source_url))
    .map((c) => ({
      workspace_id: workspaceId,
      content_item_id: contentItemId,
      claim_text: c.claim_text,
      claim_quote: c.quote,
      source: c.source,
      source_url: c.source_url,
      source_title: c.source_title,
      source_type: c.source_type,
      why_match: c.why_match,
      confidence: c.confidence,
      verify_evidence: c.verify_evidence,
      status: 'suggested',
    }))

  if (toInsert.length === 0) {
    return { ran: true, inserted: 0, claimsConsidered: result.claimsConsidered }
  }

  const insertRes = await sb('blog_citations', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(toInsert),
  })
  if (!insertRes.ok) {
    const body = await insertRes.text().catch(() => '')
    console.error(`[citations/runForContentItem] insert failed ${insertRes.status}: ${body.slice(0, 300)}`)
    return { ran: true, inserted: 0, claimsConsidered: result.claimsConsidered, reason: 'insert_failed' }
  }

  return { ran: true, inserted: toInsert.length, claimsConsidered: result.claimsConsidered }
}
