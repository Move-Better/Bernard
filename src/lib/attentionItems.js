// Attention queue — turns every "needs a human" signal on Home into a flat,
// severity-ordered list of ITEMS, each carrying its own deep link.
//
// This is a pure function on purpose. The rules below (what counts as
// blocked, what a row links to, how ties break) are the whole feature, and
// logic that lives inline in a component can only be tested by a copy of
// itself — so it goes here, and both Home and the tests call the same code.
//
// Why items and not counts (Q, 2026-08-11 — "it needs to be easy and 1 click
// to an actionable moment"): the old strip rendered eight counts that each
// linked to a filtered LIST, so acting on anything cost at least two clicks
// and a second round of triage. Two links didn't even manage that much —
// "N overdue" went to /new, a blank new-interview page that never named who
// was overdue, and words-approval (the hardest gate in the pipeline, it
// blocks ALL publishing for a story) went to /stories, entirely unfiltered.
//
// The strip also lied about completeness: failed posts and disconnected
// channels rendered as their own separate banners and were excluded from the
// headline count, so "16 items need your attention" was never the real total.
// They are folded in here as the `blocked` tier, which is what makes the
// number honest.

import { stripStoryDatePrefix } from '@/lib/storyTitle'

/** Severity tiers, most urgent first. Render order is exactly this order. */
export const TIERS = /** @type {const} */ (['blocked', 'waiting', 'slipping'])

/** A person is "slipping" once this long has passed since their last interview. */
export const OVERDUE_MS = 30 * 24 * 60 * 60 * 1000

const TIER_RANK = { blocked: 0, waiting: 1, slipping: 2 }

/** Most recent activity on a story, as an epoch ms. Missing dates sort oldest. */
function storyActivityAt(story) {
  const t = Date.parse(story?.last_activity_at || story?.updated_at || story?.created_at || '')
  return Number.isFinite(t) ? t : 0
}

/** Newest interview timestamp for a person, or null if they have none. */
function lastInterviewAt(person) {
  const list = Array.isArray(person?.interviews) ? person.interviews : []
  let latest = 0
  for (const i of list) {
    const t = Date.parse(i?.updated_at || i?.created_at || '')
    if (Number.isFinite(t) && t > latest) latest = t
  }
  return latest || null
}

function plural(n, one, many) {
  return n === 1 ? one : many
}

/**
 * Human phrasing for how long ago someone last spoke to Bernard. Deliberately
 * coarse — "6 weeks ago" is the actionable fact; the exact day is not.
 */
export function lastSpokeLabel(at, now) {
  if (!at) return 'Never interviewed'
  const days = Math.floor((now - at) / (24 * 60 * 60 * 1000))
  if (days < 1) return 'Last spoke today'
  if (days < 14) return `Last spoke ${days} ${plural(days, 'day', 'days')} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 9) return `Last spoke ${weeks} weeks ago`
  const months = Math.floor(days / 30)
  return `Last spoke ${months} ${plural(months, 'month', 'months')} ago`
}

/**
 * A staff row that should never appear in a clinician-facing list.
 *
 * Counts hid these; a NAMED list cannot. Move Better's "7 overdue" included
 * two e2e test fixtures, so the number a human read had been overstated since
 * the strip shipped (found 2026-08-11 by rendering the real rows into the
 * mockup rather than drawing a plausible-looking list).
 */
export function isHiddenStaff(person) {
  return !!person?.archived_at
}

/**
 * Build the attention queue.
 *
 * Every argument is already-fetched data — this function performs no IO, so a
 * caller that can't supply a source just passes an empty array and that
 * category contributes nothing.
 *
 * @param {object} input
 * @param {Array<object>} [input.stories]        rolled-up interview+pieces shapes
 * @param {Array<object>} [input.staff]          staff card rows (with `interviews`)
 * @param {boolean} [input.isEditor]             may publish / see distribution state
 * @param {boolean} [input.canReview]            may act on the review queue
 * @param {Array<object>} [input.yourReview]     blog drafts awaiting this author
 * @param {Array<object>} [input.yourAnswerReview] answers awaiting this author
 * @param {Array<object>} [input.wordsApprovals] `{ id, topic }` interviews needing sign-off
 * @param {Array<object>} [input.supersessions]  `{ id, summary }` pending thinking updates
 * @param {Array<object>} [input.brokenChannels] `{ key, label }` disconnected channels
 * @param {number} [input.now]                   injected clock, for tests
 * @returns {{ items: object[], total: number, byTier: Record<string, object[]>, counts: Record<string, number> }}
 */
export function buildAttentionItems({
  stories = [],
  staff = [],
  isEditor = false,
  canReview = false,
  yourReview = [],
  yourAnswerReview = [],
  wordsApprovals = [],
  supersessions = [],
  brokenChannels = [],
  now = Date.now(),
} = {}) {
  const items = []

  // ── blocked ───────────────────────────────────────────────────────────
  // Something is already broken in the outside world. These used to be two
  // standalone banners bracketing the strip; folding them in is what lets the
  // headline count claim to be everything.

  for (const ch of brokenChannels) {
    items.push({
      key: `channel:${ch.key || ch.label}`,
      tier: 'blocked',
      kind: 'channel',
      title: `${ch.label} is disconnected`,
      meta: 'Nothing can publish here until it is reconnected',
      to: '/settings/integrations',
      cta: 'Reconnect',
      sortAt: 0, // a dead channel always leads its tier
    })
  }

  if (isEditor) {
    for (const story of stories) {
      const failed = (story.pieces || []).filter((p) => p?.status === 'failed')
      if (failed.length === 0) continue
      items.push({
        key: `failed:${story.id}`,
        tier: 'blocked',
        kind: 'failed',
        title: stripStoryDatePrefix(story.topic) || 'Untitled story',
        meta: `${failed.length} ${plural(failed.length, 'post', 'posts')} failed to publish`,
        // Straight to the post when there's one; the pre-filtered list when
        // there are several, so it's never a hunt through everything.
        to: failed.length === 1 ? `/publish/${failed[0].id}` : '/stories?status=failed',
        cta: 'Fix',
        sortAt: storyActivityAt(story),
      })
    }
  }

  // ── waiting on you ────────────────────────────────────────────────────

  // Words approval leads the tier: it blocks ALL publishing for its story, and
  // before ProducerHome it had no aggregate surface anywhere at all.
  for (const iv of wordsApprovals) {
    items.push({
      key: `words:${iv.id}`,
      tier: 'waiting',
      kind: 'words',
      title: stripStoryDatePrefix(iv.topic) || 'Untitled story',
      meta: 'Approve your words before anything from this can publish',
      to: `/stories/${iv.id}`,
      cta: 'Approve',
      sortAt: Date.parse(iv.created_at || '') || 0,
      urgent: true,
    })
  }

  if (canReview) {
    for (const story of stories) {
      if (story.story_stage !== 'review') continue
      const inReview = (story.pieces || []).filter((p) => p?.status === 'in_review')
      if (inReview.length === 0) continue
      items.push({
        key: `review:${story.id}`,
        tier: 'waiting',
        kind: 'review',
        title: stripStoryDatePrefix(story.topic) || 'Untitled story',
        meta: [
          `${inReview.length} ${plural(inReview.length, 'post', 'posts')} to review`,
          story.staff_name,
        ].filter(Boolean).join(' · '),
        to: inReview.length === 1 ? `/publish/${inReview[0].id}` : `/stories/${story.id}`,
        cta: 'Review',
        sortAt: storyActivityAt(story),
      })
    }
  }

  if (isEditor) {
    for (const story of stories) {
      const approved = (story.pieces || []).filter((p) => p?.status === 'approved')
      if (approved.length === 0) continue
      items.push({
        key: `publish:${story.id}`,
        tier: 'waiting',
        kind: 'publish',
        title: stripStoryDatePrefix(story.topic) || 'Untitled story',
        meta: [
          approved.length === 1
            ? 'Approved, ready to publish'
            : `${approved.length} approved, ready to publish`,
          story.staff_name,
        ].filter(Boolean).join(' · '),
        to: approved.length === 1 ? `/publish/${approved[0].id}` : `/stories/${story.id}`,
        cta: 'Publish',
        sortAt: storyActivityAt(story),
      })
    }
  }

  // A completed interview that produced nothing yet. Kept from the old strip's
  // "N to draft" — dropping it while the ask was "show everything" would have
  // been a silent narrowing.
  for (const story of stories) {
    if (story.story_stage !== 'drafting') continue
    if ((story.pieces_count || 0) !== 0) continue
    items.push({
      key: `draft:${story.id}`,
      tier: 'waiting',
      kind: 'draft',
      title: stripStoryDatePrefix(story.topic) || 'Untitled story',
      meta: ['Nothing drafted from this yet', story.staff_name].filter(Boolean).join(' · '),
      to: `/stories/${story.id}`,
      cta: 'Draft',
      sortAt: storyActivityAt(story),
    })
  }

  for (const post of yourReview) {
    items.push({
      key: `blog:${post.id || post.content_item_id}`,
      tier: 'waiting',
      kind: 'blog',
      title: stripStoryDatePrefix(post.title || post.topic) || 'Blog draft',
      meta: 'Blog draft waiting on your read',
      to: '/week',
      cta: 'Read',
      sortAt: Date.parse(post.created_at || '') || 0,
    })
  }

  for (const answer of yourAnswerReview) {
    items.push({
      key: `answer:${answer.id}`,
      tier: 'waiting',
      kind: 'answer',
      title: answer.question || 'Answer awaiting review',
      meta: 'Your answer is ready for a final read',
      to: '/answers-review',
      cta: 'Review',
      sortAt: Date.parse(answer.created_at || '') || 0,
    })
  }

  for (const s of supersessions) {
    items.push({
      key: `thinking:${s.id}`,
      tier: 'waiting',
      kind: 'supersession',
      title: s.summary || 'Bernard noticed your thinking changed',
      meta: 'Confirm this before it changes what gets published',
      to: '/settings/practice-brain',
      cta: 'Confirm',
      sortAt: Date.parse(s.created_at || '') || 0,
    })
  }

  // ── slipping ──────────────────────────────────────────────────────────
  // Nobody is blocked, but the pipeline is quietly starving.

  for (const person of staff) {
    if (isHiddenStaff(person)) continue
    const at = lastInterviewAt(person)
    if (at && now - at < OVERDUE_MS) continue
    items.push({
      key: `overdue:${person.id}`,
      tier: 'slipping',
      kind: 'overdue',
      title: person.name || 'Unnamed',
      meta: lastSpokeLabel(at, now),
      // Prefilled so the row lands on THIS person's interview, not a blank page.
      to: `/new?staff=${encodeURIComponent(person.id)}`,
      cta: 'Start',
      // Never-interviewed sorts oldest (0), so it leads.
      sortAt: at || 0,
    })
  }

  // Severity first, then oldest first inside a tier — the thing that has been
  // waiting longest is the thing most likely to be forgotten.
  items.sort((a, b) => (TIER_RANK[a.tier] - TIER_RANK[b.tier]) || (a.sortAt - b.sortAt))

  const byTier = { blocked: [], waiting: [], slipping: [] }
  for (const item of items) byTier[item.tier].push(item)

  return {
    items,
    total: items.length,
    byTier,
    counts: {
      blocked: byTier.blocked.length,
      waiting: byTier.waiting.length,
      slipping: byTier.slipping.length,
    },
  }
}

/**
 * Headline sentence for the card. Leads with what is broken, because that is
 * what changes the reader's next action.
 */
export function attentionSummary(counts) {
  const parts = []
  if (counts.blocked) parts.push(`${counts.blocked} blocked`)
  if (counts.waiting) parts.push(`${counts.waiting} waiting on you`)
  if (counts.slipping) parts.push(`${counts.slipping} slipping`)
  return parts.join(' · ')
}
