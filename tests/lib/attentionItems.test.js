import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildAttentionItems, attentionSummary, isHiddenStaff, lastSpokeLabel, OVERDUE_MS, TIERS,
} from '../../src/lib/attentionItems.js'
import { brokenChannelsFrom } from '../../src/lib/channelHealth.js'

// The attention queue is the only thing standing between a clinician and a
// silently growing backlog, and its rules are exactly the kind that rot: a
// count that quietly excludes a category, a link that lands on a list instead
// of a thing, a test fixture that inflates a number nobody re-derives.
//
// These pin the rules that were WRONG before 2026-08-11, so a regression to
// any of them reddens rather than shipping green.

const NOW = Date.parse('2026-08-11T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function story(over = {}) {
  return {
    id: 'story-1',
    topic: 'Hip extension',
    staff_name: 'Dr. Q',
    story_stage: 'drafting',
    pieces: [],
    pieces_count: 0,
    updated_at: new Date(NOW - DAY).toISOString(),
    ...over,
  }
}

function person(over = {}) {
  return { id: 'staff-1', name: 'Dr. Q', interviews: [], archived_at: null, ...over }
}

describe('buildAttentionItems — deep links reach a THING, not a list', () => {
  // The whole of Q's complaint: "it needs to be easy and 1 click to an
  // actionable moment". Every one of these destinations used to be a filtered
  // list you then had to triage a second time.
  it('links a single approved post straight to that post', () => {
    const { byTier } = buildAttentionItems({
      isEditor: true,
      stories: [story({ pieces: [{ id: 'piece-9', status: 'approved' }], pieces_count: 1 })],
      now: NOW,
    })
    const item = byTier.waiting.find((i) => i.kind === 'publish')
    expect(item.to).toBe('/publish/piece-9')
  })

  it('links an overdue person to their OWN prefilled interview, never a blank /new', () => {
    const { byTier } = buildAttentionItems({ staff: [person({ id: 'abc-123' })], now: NOW })
    const item = byTier.slipping[0]
    expect(item.to).toBe('/new?staff=abc-123')
    // The old strip sent all of them to a bare /new that never named anyone.
    expect(item.to).not.toBe('/new')
  })

  it('links words-approval to the specific story, never the unfiltered /stories', () => {
    const { byTier } = buildAttentionItems({
      wordsApprovals: [{ id: 'iv-7', topic: 'Shoulder' }],
      now: NOW,
    })
    const item = byTier.waiting.find((i) => i.kind === 'words')
    expect(item.to).toBe('/stories/iv-7')
    expect(item.to).not.toBe('/stories')
  })

  it('falls back to the story when several posts share a status', () => {
    const { byTier } = buildAttentionItems({
      isEditor: true,
      stories: [story({
        id: 's-2',
        pieces: [{ id: 'p1', status: 'approved' }, { id: 'p2', status: 'approved' }],
        pieces_count: 2,
      })],
      now: NOW,
    })
    expect(byTier.waiting.find((i) => i.kind === 'publish').to).toBe('/stories/s-2')
  })

  it('every item carries a destination and a verb', () => {
    const { items } = buildAttentionItems({
      isEditor: true,
      canReview: true,
      stories: [
        story({ id: 'a', pieces: [{ id: 'p1', status: 'failed' }], pieces_count: 1 }),
        story({ id: 'b', story_stage: 'review', pieces: [{ id: 'p2', status: 'in_review' }], pieces_count: 1 }),
      ],
      staff: [person()],
      wordsApprovals: [{ id: 'iv-1', topic: 'T' }],
      supersessions: [{ id: 'ss-1', summary: 'S' }],
      yourReview: [{ id: 'b-1', title: 'Blog' }],
      yourAnswerReview: [{ id: 'a-1', question: 'Q?' }],
      brokenChannels: [{ key: 'account:INSTAGRAM', label: 'Instagram' }],
      now: NOW,
    })
    expect(items.length).toBeGreaterThan(6)
    for (const item of items) {
      expect(item.to, `${item.kind} has no destination`).toBeTruthy()
      expect(item.cta, `${item.kind} has no verb`).toBeTruthy()
      expect(TIERS).toContain(item.tier)
    }
  })
})

describe('buildAttentionItems — the total is honest', () => {
  // Failed posts and dead channels rendered as SEPARATE banners and were
  // excluded from the strip's count, so "16 items need your attention" was
  // never the real number. Folding them in is the fix; this pins it.
  it('counts failed posts and disconnected channels in the total', () => {
    const args = {
      isEditor: true,
      stories: [story({ pieces: [{ id: 'p1', status: 'failed' }], pieces_count: 1 })],
      brokenChannels: [{ key: 'account:INSTAGRAM', label: 'Instagram' }],
      now: NOW,
    }
    const { total, counts } = buildAttentionItems(args)
    expect(counts.blocked).toBe(2)
    expect(total).toBe(2)
  })

  it('total always equals the number of rows rendered', () => {
    const { total, byTier } = buildAttentionItems({
      isEditor: true,
      canReview: true,
      stories: [
        story({ id: 'a', pieces: [{ id: 'p1', status: 'approved' }], pieces_count: 1 }),
        story({ id: 'b', story_stage: 'review', pieces: [{ id: 'p2', status: 'in_review' }], pieces_count: 1 }),
        story({ id: 'c' }),
      ],
      staff: [person(), person({ id: 's2', name: 'B' })],
      now: NOW,
    })
    const rendered = TIERS.reduce((n, t) => n + byTier[t].length, 0)
    expect(rendered).toBe(total)
  })
})

describe('buildAttentionItems — ordering', () => {
  it('puts blocked before waiting before slipping', () => {
    const { items } = buildAttentionItems({
      isEditor: true,
      stories: [story({ id: 'a', pieces: [{ id: 'p1', status: 'approved' }], pieces_count: 1 })],
      staff: [person()],
      brokenChannels: [{ key: 'c', label: 'Instagram' }],
      now: NOW,
    })
    expect(items.map((i) => i.tier)).toEqual(['blocked', 'waiting', 'slipping'])
  })

  it('sorts oldest first inside a tier — the forgotten thing leads', () => {
    const { byTier } = buildAttentionItems({
      isEditor: true,
      stories: [
        story({ id: 'new', topic: 'Newer', updated_at: new Date(NOW - DAY).toISOString(), pieces: [{ id: 'p1', status: 'approved' }], pieces_count: 1 }),
        story({ id: 'old', topic: 'Older', updated_at: new Date(NOW - 40 * DAY).toISOString(), pieces: [{ id: 'p2', status: 'approved' }], pieces_count: 1 }),
      ],
      now: NOW,
    })
    expect(byTier.waiting.map((i) => i.title)).toEqual(['Older', 'Newer'])
  })
})

describe('buildAttentionItems — permissions gate categories', () => {
  it('hides publish and failed rows from a non-editor', () => {
    const stories = [story({ pieces: [{ id: 'p1', status: 'approved' }, { id: 'p2', status: 'failed' }], pieces_count: 2 })]
    expect(buildAttentionItems({ stories, isEditor: false, now: NOW }).total).toBe(0)
    expect(buildAttentionItems({ stories, isEditor: true, now: NOW }).total).toBe(2)
  })

  it('hides the review queue from someone who cannot review', () => {
    const stories = [story({ story_stage: 'review', pieces: [{ id: 'p1', status: 'in_review' }], pieces_count: 1 })]
    expect(buildAttentionItems({ stories, canReview: false, now: NOW }).total).toBe(0)
    expect(buildAttentionItems({ stories, canReview: true, now: NOW }).total).toBe(1)
  })
})

describe('archived staff never reach a clinician-facing list', () => {
  // Move Better's "7 overdue" included two e2e test fixtures. A count hid
  // them; naming every row exposed them. The honest number was 5.
  it('drops archived people from the slipping tier', () => {
    const { counts } = buildAttentionItems({
      staff: [
        person({ id: 'real-1', name: 'Alli Madsen' }),
        person({ id: 'e2e-1', name: 'E2E Smoke Clinician', archived_at: '2026-08-11T00:00:00Z' }),
        person({ id: 'e2e-2', name: 'e2e', archived_at: '2026-08-11T00:00:00Z' }),
      ],
      now: NOW,
    })
    expect(counts.slipping).toBe(1)
  })

  it('isHiddenStaff keys on archived_at, not on the name', () => {
    // Name-matching would be a trap: a real clinician could be called
    // anything, and a renamed fixture would silently come back.
    expect(isHiddenStaff({ name: 'e2e', archived_at: null })).toBe(false)
    expect(isHiddenStaff({ name: 'Dr. Q', archived_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
})

describe('overdue threshold', () => {
  it('includes someone who has never been interviewed', () => {
    const { counts } = buildAttentionItems({ staff: [person({ interviews: [] })], now: NOW })
    expect(counts.slipping).toBe(1)
  })

  it('excludes someone who spoke inside the window', () => {
    const { counts } = buildAttentionItems({
      staff: [person({ interviews: [{ updated_at: new Date(NOW - 5 * DAY).toISOString() }] })],
      now: NOW,
    })
    expect(counts.slipping).toBe(0)
  })

  it('includes someone just past the window', () => {
    const { counts } = buildAttentionItems({
      staff: [person({ interviews: [{ updated_at: new Date(NOW - OVERDUE_MS - 1000).toISOString() }] })],
      now: NOW,
    })
    expect(counts.slipping).toBe(1)
  })

  it('uses the NEWEST interview, not the first one it finds', () => {
    const { counts } = buildAttentionItems({
      staff: [person({ interviews: [
        { updated_at: new Date(NOW - 400 * DAY).toISOString() },
        { updated_at: new Date(NOW - 2 * DAY).toISOString() },
      ] })],
      now: NOW,
    })
    expect(counts.slipping).toBe(0)
  })
})

describe('row copy', () => {
  it('strips the date prefix from a stored story title', () => {
    const { byTier } = buildAttentionItems({
      isEditor: true,
      stories: [story({
        topic: 'July 10, 2026 — Hip extension and opposite-shoulder stability',
        pieces: [{ id: 'p1', status: 'approved' }],
        pieces_count: 1,
      })],
      now: NOW,
    })
    expect(byTier.waiting[0].title).toBe('Hip extension and opposite-shoulder stability')
  })

  it('describes how long ago someone spoke in human units', () => {
    expect(lastSpokeLabel(null, NOW)).toBe('Never interviewed')
    expect(lastSpokeLabel(NOW - 3 * DAY, NOW)).toBe('Last spoke 3 days ago')
    expect(lastSpokeLabel(NOW - 1 * DAY, NOW)).toBe('Last spoke 1 day ago')
    expect(lastSpokeLabel(NOW - 30 * DAY, NOW)).toBe('Last spoke 4 weeks ago')
    expect(lastSpokeLabel(NOW - 200 * DAY, NOW)).toBe('Last spoke 6 months ago')
  })

  it('leads the summary with what is broken', () => {
    expect(attentionSummary({ blocked: 2, waiting: 9, slipping: 5 }))
      .toBe('2 blocked · 9 waiting on you · 5 slipping')
    expect(attentionSummary({ blocked: 0, waiting: 3, slipping: 0 })).toBe('3 waiting on you')
  })
})

describe('brokenChannelsFrom', () => {
  it('flags a disconnected account', () => {
    expect(brokenChannelsFrom({ accounts: [{ type: 'INSTAGRAM', connected: false }] }))
      .toEqual([{ key: 'account:INSTAGRAM', label: 'Instagram' }])
  })

  it('ignores a location that never had a team — that is not a drop', () => {
    // Flagging these would make the alarm cry wolf on every fresh workspace.
    expect(brokenChannelsFrom({ locations: [{ id: 'l1', label: 'Main', hasTeam: false, connected: false }] }))
      .toEqual([])
  })

  it('flags a connected-then-dropped location', () => {
    expect(brokenChannelsFrom({ locations: [{ id: 'l1', label: 'Main', hasTeam: true, connected: false }] }))
      .toEqual([{ key: 'location:l1', label: 'Google Business Profile (Main)' }])
  })

  it('is empty for healthy or missing data', () => {
    expect(brokenChannelsFrom(null)).toEqual([])
    expect(brokenChannelsFrom({ accounts: [{ type: 'INSTAGRAM', connected: true }] })).toEqual([])
  })
})

describe('GUARD — the queue stays wired into Home', () => {
  // Home rendered three separate surfaces before this; the risk on any future
  // edit is that one of the old banners gets re-added alongside the card, or
  // that the card is dropped and the page silently stops showing the queue.
  const home = readFileSync(fileURLToPath(new URL('../../src/pages/Home.jsx', import.meta.url)), 'utf8')

  it('renders AttentionQueue', () => {
    expect(home).toMatch(/<AttentionQueue\s/)
  })

  it('does not resurrect the standalone channel-health banner', () => {
    expect(home).not.toMatch(/ChannelHealthBanner/)
  })

  it('builds the queue from the shared pure function rather than inline counts', () => {
    expect(home).toMatch(/buildAttentionItems\(/)
  })
})
