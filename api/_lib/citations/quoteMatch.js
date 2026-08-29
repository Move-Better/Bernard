// api/_lib/citations/quoteMatch.js
//
// The ONE shared exact-substring-match rule behind both halves of the
// "Link placement — LOCKED 2026-08-28" design in
// .claude/blog-research-citations-spec.md:
//   - the publish-time inline-insertion decision (insertCitations.js)
//   - the review panel's live per-citation "will this actually inline?"
//     indicator (citations-list.js)
//
// One copy, imported by both, so they can never drift the way the mockup
// notes explicitly worried about (a stale flag vs. a live check). Per the
// locked design: exact, case-sensitive, whole-substring match. No fuzzy,
// normalized, or partial matching, ever. Zero matches or more than one match
// both mean "do not inline" — inserting into the wrong occurrence is worse
// than not inlining at all.
//
// PURE: no env, no network, no side effects.

/**
 * Find every exact, case-sensitive occurrence of `quote` in `body`. Pure.
 * Overlapping occurrences are counted too (deliberately conservative — an
 * ambiguous match is exactly the case this whole module exists to catch).
 * @param {string} body
 * @param {string} quote
 * @returns {{count: number, index: number}} `index` is the FIRST occurrence's
 *   start offset (or -1 if none). Callers should only act on `count === 1`.
 */
export function findExactQuoteSpan(body, quote) {
  const text = String(body || '')
  const q = String(quote || '').trim()
  if (!q) return { count: 0, index: -1 }

  let count = 0
  let index = -1
  let from = 0
  for (;;) {
    const at = text.indexOf(q, from)
    if (at === -1) break
    if (count === 0) index = at
    count++
    from = at + 1
  }
  return { count, index }
}

/**
 * Would approving this citation right now produce an inline link? True only
 * on an exact, single occurrence of `quote` in the CURRENT `body` — the same
 * rule insertCitations.js enforces at publish time. The review panel calls
 * this at render time (never a stale flag captured at enrichment time), per
 * the spec's "a live check when the panel renders."
 * @param {string} body
 * @param {string} quote
 * @returns {boolean}
 */
export function willInlineLink(body, quote) {
  return findExactQuoteSpan(body, quote).count === 1
}
