import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildAttentionItems, KIND_OWNER } from '../../src/lib/attentionItems.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const CHECKPOINTS = read('../../api/_routes/producer/checkpoints.js')
const PRODUCER_HOME = read('../../src/pages/ProducerHome.jsx')
const HOME = read('../../src/pages/Home.jsx')

const NOW = Date.parse('2026-08-11T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

// CombinedHome stacks ProducerHome's queue above Home's practice card for an
// owner who is also a clinician. Both list work; without a rule they drift
// into listing the SAME work under two definitions with two numbers, which is
// how a queue stops being believed.
//
// The rule (Q, 2026-08-11): one item, one region, chosen by which hat you
// wear to act on it.

function story(over = {}) {
  return {
    id: 's1', topic: 'Hip extension', staff_name: 'Dr. Q',
    story_stage: 'drafting', pieces: [], pieces_count: 0,
    updated_at: new Date(NOW - DAY).toISOString(), ...over,
  }
}

const FULL_INPUT = {
  isEditor: true,
  canReview: true,
  stories: [
    story({ id: 'a', pieces: [{ id: 'p1', status: 'failed' }], pieces_count: 1 }),
    story({ id: 'b', story_stage: 'review', pieces: [{ id: 'p2', status: 'in_review' }], pieces_count: 1 }),
    story({ id: 'c', pieces: [{ id: 'p3', status: 'approved' }], pieces_count: 1 }),
    story({ id: 'd' }), // drafting, no pieces → `draft`
  ],
  staff: [{ id: 'st1', name: 'Alli', interviews: [], archived_at: null }],
  wordsApprovals: [{ id: 'iv1', topic: 'Shoulder' }],
  supersessions: [{ id: 'ss1', summary: 'Thinking changed' }],
  yourReview: [{ id: 'b1', title: 'Blog draft' }],
  yourAnswerReview: [{ id: 'an1', question: 'Why?' }],
  brokenChannels: [{ key: 'account:INSTAGRAM', label: 'Instagram' }],
  now: NOW,
}

describe('one item, one region', () => {
  it('keeps everything when Home is the only home', () => {
    // A clinician-only workspace has no ProducerHome — Home must not hand its
    // operational rows to a surface that does not exist.
    const { items } = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: false })
    const kinds = new Set(items.map((i) => i.kind))
    for (const k of ['channel', 'failed', 'publish', 'review', 'draft']) {
      expect(kinds.has(k), `${k} should be present standalone`).toBe(true)
    }
  })

  it('hands producer-owned rows to the producer when its queue is on screen', () => {
    const { items } = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: true })
    const kinds = items.map((i) => i.kind)
    for (const k of ['channel', 'failed', 'publish', 'review', 'draft']) {
      expect(kinds, `${k} should move to the producer surface`).not.toContain(k)
    }
  })

  it('never drops the clinician rows — those are nobody else’s', () => {
    const { items } = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: true })
    const kinds = new Set(items.map((i) => i.kind))
    for (const k of ['words', 'blog', 'answer', 'supersession', 'overdue']) {
      expect(kinds.has(k), `${k} must stay on the practice card`).toBe(true)
    }
  })

  it('the total still equals the rows rendered after filtering', () => {
    // The bug this card exists to fix, re-introduced from a new angle: filter
    // the rows but keep the unfiltered count and the headline lies again.
    const q = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: true })
    const rendered = q.byTier.blocked.length + q.byTier.waiting.length + q.byTier.slipping.length
    expect(q.total).toBe(rendered)
    expect(q.items.length).toBe(rendered)
  })

  it('filtering strictly reduces — the producer view is a subset', () => {
    const all = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: false })
    const some = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: true })
    expect(some.total).toBeLessThan(all.total)
  })

  it('every kind the builder can emit has a declared owner', () => {
    // An unmapped kind is KEPT (fail-open, so nothing silently vanishes from
    // Home) — but it also means the boundary was never decided for it. This
    // fails when a new kind is added without that decision.
    const { items } = buildAttentionItems({ ...FULL_INPUT, producerSurfaceShown: false })
    const emitted = [...new Set(items.map((i) => i.kind))]
    expect(emitted.length).toBeGreaterThanOrEqual(10)
    for (const k of emitted) {
      expect(KIND_OWNER[k], `kind "${k}" has no owner in KIND_OWNER`).toBeDefined()
    }
  })

  it('Home passes its embedded flag through as the boundary signal', () => {
    expect(HOME).toMatch(/producerSurfaceShown:\s*embedded/)
  })
})

describe('the producer headline counts items, not cards', () => {
  it('declares a per-card decision count', () => {
    expect(CHECKPOINTS).toMatch(/card\.items\s*=/)
  })

  it('counts the check-in as ONE decision, not its published total', () => {
    // learning_checkin's `count` is how many posts there are to review (62),
    // not how many decisions are pending (one: do the check-in). Summing
    // `count` blindly would overstate the headline as badly as counting cards
    // understated it.
    expect(CHECKPOINTS).toMatch(/learning_checkin:\s*\(\)\s*=>\s*1/)
  })

  it('splits backlog out of the waiting-on-you number', () => {
    // Tier-4 cards say in their own gate line that nothing is blocked by them.
    expect(CHECKPOINTS).toMatch(/decisions:.*tier <= 3/s)
    expect(CHECKPOINTS).toMatch(/backlog:.*tier >= 4/s)
  })

  it('returns the summary to the client', () => {
    expect(CHECKPOINTS).toMatch(/^\s*summary,$/m)
  })

  it('ProducerHome renders decisions, not queue.length', () => {
    expect(PRODUCER_HOME).toMatch(/gate for \$\{decisions\}/)
    expect(PRODUCER_HOME).not.toMatch(/gate for \$\{queue\.length\}/)
  })

  it('falls back to the card count on a payload with no summary', () => {
    // A cached response from before this shipped must not render NaN.
    expect(PRODUCER_HOME).toMatch(/summary \? summary\.decisions : queue\.length/)
  })
})

describe('both sections name their hat', () => {
  it('the producer queue says so', () => {
    expect(PRODUCER_HOME).toMatch(/as the producer/)
  })

  it('the practice card says so', () => {
    expect(HOME).toMatch(/as a clinician/)
  })

  it('the practice label is shared, not duplicated per render state', () => {
    // The skeleton and the loaded page each used to carry their own copy of
    // this string, so changing one alone made the label flicker mid-load.
    const uses = HOME.match(/<PracticeSectionLabel \/>/g) || []
    expect(uses.length).toBe(2)
    expect(HOME.match(/as a clinician/g)?.length).toBe(1)
  })
})

describe('the failed-publish card deep-links to the post', () => {
  it('links to the item when there is exactly one', () => {
    expect(CHECKPOINTS).toMatch(/\/publish\/\$\{failures\.firstItemId\}/)
  })

  it('only falls back to the integrations page when no item id is known', () => {
    // The card used to send EVERY failure there — a guess at the cause, and
    // the wrong page whenever the failure wasn't a dead connection.
    expect(CHECKPOINTS).toMatch(/failures\.firstItemId \? '\/stories\?status=failed' : '\/settings\/integrations'/)
  })
})
