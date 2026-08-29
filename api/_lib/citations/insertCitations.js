// api/_lib/citations/insertCitations.js
//
// The ONLY place an approved citation gets mechanically inserted into a
// published post body. Per .claude/blog-research-citations-spec.md's "Link
// placement — LOCKED 2026-08-28" (Q, overriding this file's original
// footer-only ship): an approved citation is hyperlinked INLINE, at the exact
// sentence it supports, AND listed again in the "Further reading" footer.
// "The redundancy adds clarity" — both, not either/or, whenever it's safely
// possible.
//
// The safety property this file originally shipped with is preserved, not
// removed: the `claim_quote` a citation was matched to is captured at
// enrichment time, but a human may approve it much later, after the body was
// hand-edited (this project treats hand-edited/voice-fidelity prose as close
// to sacred — see CLAUDE.md's "A preview is not the published artifact" and
// the voice-fidelity doctrine). So inline insertion only happens on an EXACT,
// case-sensitive, SINGLE-occurrence substring match of `claim_quote` against
// the body, checked FRESH right here at publish time (never a stale flag from
// enrichment) — see quoteMatch.js, the one shared implementation of this rule
// (also used by the review panel's live per-citation indicator). Zero matches
// or more than one match both mean "do not guess" — footer-only for that one
// citation, a silent, safe degrade. The footer entry is appended in EVERY
// case, independent of whether inlining succeeded.
//
// insertApprovedCitations is PURE (no env, no network). fetchApprovedCitations
// (below) is the one network-touching export — the read that feeds it, done
// fresh at publish time so a decision made seconds before publish is honored.
// Anchor text is ALWAYS the citation's real, retrieval-sourced source_title
// (never invented here) — falls back to the hostname only when a title
// genuinely wasn't captured, never to "click here" per this project's
// internal-link convention (getBlogPostSystemPrompt).

import { supabaseRest } from '../supabaseRest.js'
import { findExactQuoteSpan } from './quoteMatch.js'

const sb = (path, init = {}) => supabaseRest(path, init, { timeoutMs: 8_000 })

/**
 * Read the currently-approved citations for one content_item, workspace-
 * scoped. Network. Called at publish time, right before the body is sent to
 * the destination, so a decision made seconds before publish is honored.
 * @param {string} contentItemId
 * @param {string} workspaceId
 * @returns {Promise<Array<{source_url: string, source_title: string|null, claim_quote: string|null}>>}
 */
export async function fetchApprovedCitations(contentItemId, workspaceId) {
  if (!contentItemId || !workspaceId) return []
  const r = await sb(
    `blog_citations?content_item_id=eq.${encodeURIComponent(contentItemId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&status=eq.approved&select=source_url,source_title,claim_quote&order=confidence.desc`,
  )
  if (!r.ok) {
    console.error(`[citations/insertCitations] fetchApprovedCitations failed ${r.status} for content_item=${contentItemId}`)
    return [] // fail open on the READ — a citations-fetch hiccup must never block a publish; the post ships without the "further reading" list rather than not shipping at all
  }
  return r.json()
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return url }
}

/**
 * Insert every approved citation inline (when safely possible) AND list it in
 * a "Further reading" section — per the locked "inline AND footer, deliberate
 * redundancy" design. No-op (returns markdown unchanged, footer included with
 * zero items rendered as... nothing, see below) when there are no approved
 * citations — a post with nothing to cite ships exactly as written, per the
 * spec's "0-3 per post, never count-filled."
 *
 * For each citation, inline insertion is attempted independently against the
 * body AS IT STANDS AT THAT POINT (so citations are applied in order, one
 * quote's wrapped link never becomes eligible to be re-matched by a later
 * citation's search): an exact, case-sensitive, single-occurrence match of
 * `claim_quote` wraps that exact span in a markdown link and touches NOTHING
 * else in the body. Zero matches or more than one match both fall back to
 * footer-only for that one citation — never a guess. The footer entry is
 * appended for EVERY approved citation regardless of whether inlining
 * succeeded.
 * @param {string} markdown
 * @param {Array<{source_url: string, source_title: string|null, claim_quote?: string|null}>} approvedCitations
 * @returns {string}
 */
export function insertApprovedCitations(markdown, approvedCitations) {
  let body = String(markdown || '')
  const citations = Array.isArray(approvedCitations) ? approvedCitations.filter((c) => c?.source_url) : []
  if (citations.length === 0) return body

  for (const c of citations) {
    const quote = c.claim_quote
    if (!quote) continue // no quote captured for this citation (e.g. older row) — footer-only, nothing to search for
    const { count, index } = findExactQuoteSpan(body, quote)
    if (count !== 1) continue // not found, or ambiguous — fail safe, footer-only for this one
    const trimmedQuote = String(quote).trim()
    body = body.slice(0, index) + `[${trimmedQuote}](${c.source_url})` + body.slice(index + trimmedQuote.length)
  }

  const items = citations
    .map((c) => `- [${(c.source_title || hostnameOf(c.source_url)).trim()}](${c.source_url})`)
    .join('\n')

  const separator = body.endsWith('\n') ? '\n' : '\n\n'
  return `${body}${separator}## Further reading\n\n${items}\n`
}
