// The team-member home's "Waiting on your OK" list (Q, 2026-11-09).
//
// Only things from the person's OWN interviews that only they can approve.
// Built from the same attention rules Home uses, fed only the four
// already-own-scoped sources, so it can never pick up other people's posts or
// the clinic-wide "slipping" list. Order is Q's: blogs first, then answers,
// then word sign-offs, then thinking updates; oldest first inside each.

import { buildAttentionItems } from '@/lib/attentionItems'

export const OWN_KIND_ORDER = ['blog', 'answer', 'words', 'supersession']

/**
 * @param {object} input
 * @param {Array<object>} [input.yourReview]        blog drafts awaiting this author
 * @param {Array<object>} [input.yourAnswerReview]  answers awaiting this author
 * @param {Array<object>} [input.wordsApprovals]    interviews needing this author's sign-off
 * @param {Array<object>} [input.supersessions]     pending thinking updates
 * @param {number} [input.now]
 */
export function ownApprovalItems({ yourReview = [], yourAnswerReview = [], wordsApprovals = [], supersessions = [], now } = {}) {
  const { items } = buildAttentionItems({
    stories: [],
    staff: [],
    isEditor: false,
    canReview: false,
    brokenChannels: [],
    yourReview,
    yourAnswerReview,
    wordsApprovals,
    supersessions,
    ...(now ? { now } : {}),
  })
  const rank = (k) => {
    const i = OWN_KIND_ORDER.indexOf(k)
    return i === -1 ? OWN_KIND_ORDER.length : i
  }
  return items
    .filter((i) => OWN_KIND_ORDER.includes(i.kind))
    .sort((a, b) => (rank(a.kind) - rank(b.kind)) || (a.sortAt - b.sortAt))
}
