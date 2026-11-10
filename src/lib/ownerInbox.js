// The owner Home's one inbox (Q, 2026-11-09; simplicity audit, option B).
//
// The owner Home used to stack the producer queue above the clinician Home:
// 4.8 screens, and the same counts printed three times (the queue, an "All
// checkpoints" grid, Bernard's coaching paragraph) plus a second list titled
// "N things need you". This module decides the single list instead, so the
// page only draws. Pure on purpose: the rules are the feature, and a rule that
// lives inside a component can only be tested by a copy of itself.
//
// What goes where:
//   rows     — decisions the owner makes: producer checkpoints of tier 1-3 and
//              the owner's own clinician approvals. Ranked, one list.
//   backlog  — tier-4 checkpoints. Their own text says nothing waits on them,
//              so they are folded, never counted in the headline.
//   team     — other people's approvals. Their call, so folded and uncounted.
//   slipping — people who have not talked to Bernard in 30+ days. Folded.
//   channels — one line of days-since-last-post, not a grid of tiles.

import { channelName } from '@/lib/contentMeta'

/** Rank for the owner's own approvals. Words approval blocks ALL publishing for a story. */
export const OWN_KIND_RANK = { words: 2, blog: 3, answer: 3, supersession: 3 }

function plural(n, one, many) {
  return n === 1 ? one : many
}

/** "Review on Your week →" → "Review on Your week": the row draws its own chevron. */
function ctaText(label) {
  return String(label || 'Open').replace(/\s*→\s*$/, '')
}

/** Badge colour bucket for a rank: what the page paints, decided here so it is tested. */
export function rankTone(rank) {
  if (rank <= 1) return 'blocked'
  if (rank === 2) return 'urgent'
  return 'normal'
}

/** "3 blog drafts, 1 words approval" for one teammate. Zero counts are left out. */
export function teamPhrase(w) {
  const parts = []
  if (w.answersToReview) parts.push(`${w.answersToReview} drafted ${plural(w.answersToReview, 'answer', 'answers')}`)
  if (w.blogDrafts) parts.push(`${w.blogDrafts} blog ${plural(w.blogDrafts, 'draft', 'drafts')}`)
  if (w.wordsApprovals) parts.push(`${w.wordsApprovals} words ${plural(w.wordsApprovals, 'approval', 'approvals')}`)
  if (w.supersessions) parts.push(`${w.supersessions} memory ${plural(w.supersessions, 'update', 'updates')}`)
  return parts.join(', ')
}

function teamTotal(w) {
  return (w.answersToReview || 0) + (w.blogDrafts || 0) + (w.wordsApprovals || 0) + (w.supersessions || 0)
}

/**
 * @param {object} input
 * @param {object|null} [input.checkpoints]  /api/producer/checkpoints payload
 * @param {Array<object>} [input.ownItems]   ownApprovalItems() output for the owner
 * @param {Array<object>} [input.slipping]   attention items of tier 'slipping'
 * @param {string|null} [input.selfStaffId]  the owner's own staff id, excluded from `team`
 */
export function buildOwnerInbox({ checkpoints = null, ownItems = [], slipping = [], selfStaffId = null } = {}) {
  const queue = Array.isArray(checkpoints?.queue) ? checkpoints.queue : []

  const producerRows = queue
    .filter((c) => c.tier <= 3)
    .map((c) => ({
      key: `queue:${c.type}`,
      rank: c.tier,
      title: c.title,
      why: c.why,
      to: c.ctaHref,
      cta: ctaText(c.ctaLabel),
    }))

  const ownRows = ownItems.map((i) => ({
    key: i.key,
    rank: OWN_KIND_RANK[i.kind] ?? 3,
    title: i.title,
    why: i.meta,
    to: i.to,
    cta: i.cta,
  }))

  // Array.prototype.sort is stable, so at equal rank the producer rows stay
  // ahead of the owner's own and each keeps its server/oldest-first order.
  const rows = [...producerRows, ...ownRows].sort((a, b) => a.rank - b.rank)

  const backlog = queue
    .filter((c) => c.tier >= 4)
    .map((c) => ({ key: `queue:${c.type}`, title: c.title, to: c.ctaHref, cta: ctaText(c.ctaLabel) }))

  const team = (Array.isArray(checkpoints?.waitingOnClinicians) ? checkpoints.waitingOnClinicians : [])
    .filter((w) => !selfStaffId || w.staffId !== selfStaffId)
    .map((w) => ({ staffId: w.staffId, name: w.name, phrase: teamPhrase(w), total: teamTotal(w) }))
    .filter((w) => w.total > 0)

  const channels = (checkpoints?.health?.channels || [])
    .filter((c) => c.daysIdle != null)
    .map((c) => ({ platform: c.platform, label: channelName(c.platform), days: c.daysIdle, status: c.status }))

  return {
    rows,
    backlog,
    team,
    teamTotal: team.reduce((s, w) => s + w.total, 0),
    slipping,
    channels,
    channelsAlarm: channels.some((c) => c.status === 'stalled'),
    headline: ownerHeadline(rows.length, channels),
  }
}

/**
 * "3 things need you. No social post has gone out in 61 days."
 *
 * The second sentence only when EVERY social channel with data is stalled, and
 * it quotes the most recent of them, so it never overstates the silence.
 */
export function ownerHeadline(count, channels = []) {
  const first = count > 0
    ? `${count} ${plural(count, 'thing needs', 'things need')} you.`
    : 'Nothing needs you right now.'
  const social = channels.filter((c) => c.platform !== 'blog' && c.days != null)
  if (social.length === 0 || !social.every((c) => c.status === 'stalled')) return first
  const latest = Math.min(...social.map((c) => c.days))
  return `${first} No social post has gone out in ${latest} days.`
}
