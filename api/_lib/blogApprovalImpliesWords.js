// Blog collapses to ONE approval — the clinician's (Q, 2026-08-29; see
// .claude/decisions.md and .claude/mockups/blog-approval-bar.html).
//
// Why blog and only blog: the story-level words gate exists so ONE "is this
// true to me?" check can be amortised across every post written from that
// interview. Measured on prod (movebetter), that fan-out is real for social —
// 3.37 posts/story on Instagram, 2.16 LinkedIn, 2.06 Facebook — and is exactly
// 1.00 for blog. One story, one article: there is nothing to amortise, so the
// clinician was asked the same question twice, on two screens, and read the
// two answers as a contradiction (Philip's feedback 3b7f432c: "Blog is showing
// approved and also showing I need to approve the stories words first? Is this
// the normal process? Or an error?").
//
// So: approving a blog article IS the words approval. Approving the full
// long-form piece is a strict superset of approving the channel-neutral
// summary it was written from — the clinician has read more, not less.
//
// Deliberately NOT a general relaxation of the gate:
//   • social pieces never imply words approval (their fan-out earns the
//     separate check, and one caption is NOT a superset of the story);
//   • the server-side gate in wordsApprovalGate.js is untouched and still the
//     boundary for every publish path — this only changes who SETS
//     words_approved_at, never who may skip it;
//   • it is scoped to a real human approve of a real blog row.
//
// Accepted, user-visible consequence (surfaced in the approve confirmation,
// not hidden): because posts share an interview, approving the blog also
// greenlights that story's social posts. Q's explicit call.

/**
 * Should approving this piece also mark the parent story's words approved?
 *
 * Pure and total — no I/O, no throwing on odd input — so the rule is unit
 * testable on its own and cannot drift between the route and its tests.
 *
 * @param {object|null|undefined} piece    content_items row (needs platform + interview_id)
 * @param {string|null|undefined} newStatus the status being written by this PATCH
 * @returns {boolean}
 */
export function blogApprovalImpliesWords(piece, newStatus) {
  if (newStatus !== 'approved') return false
  if (!piece) return false
  // Blog only. Every other channel keeps the separate once-per-story check.
  if (piece.platform !== 'blog') return false
  // No parent story → nothing to mark (Moment-Miner package rows carry a null
  // interview_id and are gated by package approval instead; see
  // wordsApprovalGate.js).
  if (!piece.interview_id) return false
  return true
}

// Statuses that mean "a human has signed this article off". `approved` is the
// live case; scheduled/published are included so a row that moved on can never
// retroactively fail the gate (e.g. a republish or a retry after scheduling).
const APPROVED_STATUSES = new Set(['approved', 'scheduled', 'published'])

/**
 * Does this blog piece's OWN approval satisfy the story-words publish gate?
 *
 * The stateful half above stamps words_approved_at when the approve happens.
 * This is the stateless half, and it is what makes the policy actually true
 * rather than only true going forward:
 *
 *   • rows approved BEFORE the policy shipped have a null words_approved_at,
 *     so without this the editor (which no longer shows the words step for
 *     blog) would offer an enabled Publish button that the server then 403s —
 *     strictly worse than the contradiction it replaced. Exactly one live row
 *     was in that state when this shipped: the piece Philip reported;
 *   • any approve path that doesn't route through db/content.js still gets the
 *     policy, instead of depending on one writer having run.
 *
 * Deliberately narrow: blog only, and only for a piece a human actually
 * approved. It does NOT relax the gate for social, and it does NOT let an
 * unapproved blog through — an unapproved blog still needs the story's words,
 * exactly as before.
 *
 * @param {{platform?: string, status?: string}|null|undefined} piece
 * @returns {boolean}
 */
export function blogApprovalSatisfiesWordsGate(piece) {
  if (!piece) return false
  if (piece.platform !== 'blog') return false
  return APPROVED_STATUSES.has(piece.status)
}
