// api/_lib/citations/insertCitations.js
//
// The ONLY place an approved citation gets mechanically inserted into a
// published post body. Per .claude/blog-research-citations-spec.md: "Approved-
// only citations are inserted with descriptive anchor text."
//
// Deliberately NOT inline substring-matching a citation into the middle of
// the post's prose. The claim_text/quote the model extracted at enrichment
// time is a paraphrase or an earlier verbatim snippet of the draft — by the
// time a human approves it, the body may have been hand-edited (this project
// treats hand-edited/voice-fidelity prose as close to sacred, see CLAUDE.md's
// "A preview is not the published artifact" and the whole voice-fidelity
// doctrine), so an inline substring match is fragile and risks silently
// corrupting content if the match target has drifted or vanished. Appending a
// short "Further reading" list is simple, safe, deterministic, and doesn't
// touch a single character of the clinician's actual writing. Flagged as a
// judgment call (not a locked decision) in
// .claude/citation-review-mockup-notes.md — Q may prefer inline links once he
// sees this in practice.
//
// insertApprovedCitations is PURE (no env, no network). fetchApprovedCitations
// (below) is the one network-touching export — the read that feeds it, done
// fresh at publish time so a decision made seconds before publish is honored.
// Anchor text is ALWAYS the citation's real, retrieval-sourced source_title
// (never invented here) — falls back to the hostname only when a title
// genuinely wasn't captured, never to "click here" per this project's
// internal-link convention (getBlogPostSystemPrompt).

import { supabaseRest } from '../supabaseRest.js'

const sb = (path, init = {}) => supabaseRest(path, init, { timeoutMs: 8_000 })

/**
 * Read the currently-approved citations for one content_item, workspace-
 * scoped. Network. Called at publish time, right before the body is sent to
 * the destination, so a decision made seconds before publish is honored.
 * @param {string} contentItemId
 * @param {string} workspaceId
 * @returns {Promise<Array<{source_url: string, source_title: string|null}>>}
 */
export async function fetchApprovedCitations(contentItemId, workspaceId) {
  if (!contentItemId || !workspaceId) return []
  const r = await sb(
    `blog_citations?content_item_id=eq.${encodeURIComponent(contentItemId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
    `&status=eq.approved&select=source_url,source_title&order=confidence.desc`,
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
 * Append a "Further reading" section listing approved citations, each with
 * descriptive anchor text. No-op (returns markdown unchanged) when there are
 * no approved citations — a post with nothing to cite ships exactly as
 * written, per the spec's "0-3 per post, never count-filled."
 * @param {string} markdown
 * @param {Array<{source_url: string, source_title: string|null}>} approvedCitations
 * @returns {string}
 */
export function insertApprovedCitations(markdown, approvedCitations) {
  const body = String(markdown || '')
  const citations = Array.isArray(approvedCitations) ? approvedCitations.filter((c) => c?.source_url) : []
  if (citations.length === 0) return body

  const items = citations
    .map((c) => `- [${(c.source_title || hostnameOf(c.source_url)).trim()}](${c.source_url})`)
    .join('\n')

  const separator = body.endsWith('\n') ? '\n' : '\n\n'
  return `${body}${separator}## Further reading\n\n${items}\n`
}
