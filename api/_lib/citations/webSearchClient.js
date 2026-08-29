// api/_lib/citations/webSearchClient.js
//
// Retrieval source A ("web") from the spec: a real web-search tool call,
// reranked to the source allowlist (allowlist.js). Best for authoritative
// institution pages and guidelines (Mayo, Cleveland, ACA) that aren't in
// PubMed/Semantic Scholar.
//
// Reuses the SAME OpenAI Responses API + web_search tool this codebase already
// has live infra for (api/_lib/citationProbe.js's probeChatGPT, powering the
// /seo "Are you the answer?" scoreboard) — one credential (OPENAI_API_KEY),
// one calling convention, instead of a second web-search vendor integration.
//
// The model is asked ONLY for a search — never for a URL to cite from memory.
// Every returned candidate's `url` comes from the API's own `url_citation`
// annotation (a real search result the tool actually visited), not from the
// model's freeform text. Titles are NOT trusted from the search response
// (the annotation carries no reliable title field) — the verify step fetches
// the real page and reads its own <title>, see verify.js.
//
// "Reranked to the allowlist": the tool can't be forced to search only
// allowlisted domains, so this filters the real citation URLs down to the
// allowlist post-hoc (rerankToAllowlist, pure + testable) rather than trusting
// the model's judgment about which domains are authoritative.
//
// Every url_citation annotation carries a ?utm_source=openai tracking param
// (found while probing real runs against real content, 2026-08-27) — stripped
// via stripTrackingParams BEFORE reranking/dedup, so a citation published on a
// clinic's blog never permanently carries a tracking parameter for how it was
// found, and two annotations that differ only by that param dedupe correctly.

import { isAllowedCitationUrl } from './allowlist.js'

const OPENAI_MODEL = 'gpt-5.6-terra' // matches citationProbe.js's pinned model

/**
 * Strip utm_* tracking params (and the OpenAI web_search tool's own
 * ?utm_source=openai it appends to every citation URL) before a URL is ever
 * stored/shown. A citation published on a clinic's blog shouldn't carry a
 * permanent tracking parameter for how it happened to be found. Pure —
 * returns the input unchanged if it isn't a parseable URL, never throws.
 * @param {string} url
 * @returns {string}
 */
export function stripTrackingParams(url) {
  try {
    const u = new URL(url)
    const toDelete = [...u.searchParams.keys()].filter((k) => /^utm_/i.test(k))
    for (const k of toDelete) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Filter + dedupe a raw list of cited URLs down to the allowlist. Pure.
 * @param {string[]} urls
 * @param {{max?: number}} [opts]
 * @returns {string[]}
 */
export function rerankToAllowlist(urls, { max = 5 } = {}) {
  const seen = new Set()
  const out = []
  for (const url of Array.isArray(urls) ? urls : []) {
    if (typeof url !== 'string' || !url) continue
    if (!isAllowedCitationUrl(url)) continue // hard gate — never a judge's call
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= max) break
  }
  return out
}

/**
 * Web-search a claim and return allowlisted candidates. Network (OpenAI
 * Responses API). Untitled — the verify step fetches the real page to get a
 * real title, since the search annotation doesn't reliably carry one.
 * @param {string} claimText
 * @param {{max?: number}} [opts]
 * @returns {Promise<Array<{source: 'web', url: string, title: null}>>}
 */
export async function searchWebAllowlisted(claimText, { max = 5 } = {}) {
  const query = String(claimText || '').trim()
  if (!query) return []
  if (!process.env.OPENAI_API_KEY) return [] // source unavailable, not an error — pipeline treats missing sources as zero candidates

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: 'low' },
      tools: [{ type: 'web_search' }],
      input: `Find authoritative sources (medical institutions, professional guidelines, peer-reviewed research) that discuss: ${query}`,
      max_output_tokens: 1200,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`openai_websearch_${res.status}: ${body.slice(0, 160)}`)
  }
  const j = await res.json()
  const msg = (j.output || []).find((o) => o.type === 'message')
  const textPart = msg?.content?.find((c) => c.type === 'output_text')
  const urls = (textPart?.annotations || [])
    .filter((a) => a.type === 'url_citation' && a.url)
    .map((a) => stripTrackingParams(a.url))

  return rerankToAllowlist(urls, { max }).map((url) => ({ source: 'web', url, title: null }))
}
