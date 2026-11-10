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

const NOUNS = {
  blog: ['blog draft', 'blog drafts'],
  answer: ['drafted answer', 'drafted answers'],
  words: ['words approval', 'words approvals'],
  supersession: ['thinking update', 'thinking updates'],
}

/**
 * "3 blog drafts and 1 words approval need" — the counted phrase for a row
 * that summarises own approvals. Kinds in OWN_KIND_ORDER; the verb agrees with
 * the total.
 */
export function ownApprovalSummary(items = []) {
  const counts = new Map()
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) || 0) + 1)
  const parts = OWN_KIND_ORDER.filter((k) => counts.get(k)).map((k) => {
    const n = counts.get(k)
    return `${n} ${NOUNS[k][n === 1 ? 0 : 1]}`
  })
  if (!parts.length) return ''
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${list} ${items.length === 1 ? 'needs' : 'need'}`
}

/**
 * The footnote under "Waiting on your OK" (mockup Clinician.dc.html): the
 * person's own approved blogs that have not gone out yet, so they know the
 * next step belongs to someone else. "You already approved" only when the
 * approval is actually theirs (approvedByYou from week-summary).
 *
 * @param {Array<{topic?: string|null, approvedByYou?: boolean}>} blogs  week-summary myApprovedBlogs
 * @param {number} pendingCount  how many rows are in the list above it
 * @returns {string} '' when there is nothing to say
 */
export function approvedWaitingNote(blogs = [], pendingCount = 0) {
  const n = blogs.length
  if (!n) return ''
  const lead = pendingCount > 0 ? 'Nothing else needs you. ' : ''
  const allYours = blogs.every((b) => b.approvedByYou)
  const title = n === 1 && blogs[0].topic ? `, “${blogs[0].topic}”,` : ''
  let body
  if (n === 1) {
    body = allYours
      ? `1 blog you already approved${title} is waiting to be published.`
      : `1 of your blogs${title} is approved and waiting to be published.`
  } else {
    body = allYours
      ? `${n} blogs you already approved are waiting to be published.`
      : `${n} of your blogs are approved and waiting to be published.`
  }
  return `${lead}${body} That step is not yours.`
}
