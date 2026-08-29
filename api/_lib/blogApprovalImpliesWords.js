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
