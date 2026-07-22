import { describe, it, expect } from 'vitest'
import { buildDigest } from '../../api/_lib/engagementDigestEmail.js'

const WORKSPACE = { id: 'ws-1', slug: 'movebetter', display_name: 'Move Better' }
const BASE = {
  workspace: WORKSPACE,
  published: [],
  momentStats: { generated: 0, approved: 0, skipped: 0, failed: 0, complete_awaiting: 0 },
  triage: { failed: 0, lowConfidence: 0, stale: 0 },
  queued: [],
  weekStart: '2026-07-14T00:00:00Z',
  weekEnd: '2026-07-21T00:00:00Z',
}

describe('buildDigest — What Bernard learned section (T4)', () => {
  it('omits the section entirely when nothing was rejected or edited', () => {
    const { html, text } = buildDigest(BASE)
    expect(html).not.toContain('What Bernard learned')
    expect(text).not.toContain('Rejected:')
    expect(text).not.toContain('Edited before approving:')
  })

  it('groups reject reasons by count and surfaces a note', () => {
    const { html, text } = buildDigest({
      ...BASE,
      rejected: [
        { id: '1', topic: 'Sciatica myth', platform: 'instagram', reject_reason: 'wrong_visuals', reject_note: 'stock photo, not our clinic' },
        { id: '2', topic: 'Bicep tendon', platform: 'linkedin', reject_reason: 'wrong_visuals', reject_note: null },
        { id: '3', topic: 'Running form', platform: 'facebook', reject_reason: 'wrong_topic', reject_note: null },
      ],
    })
    expect(html).toContain('What Bernard learned')
    expect(html).toContain('3 drafts rejected')
    expect(html).toContain('2 wrong visuals')
    expect(html).toContain('1 wrong topic')
    expect(html).toContain('stock photo, not our clinic')
    expect(text).toContain('Rejected: 3')
  })

  it('surfaces edit-diff highlights via summarizeEditDiff', () => {
    const { html, text } = buildDigest({
      ...BASE,
      editDiffs: [
        {
          id: '1', topic: 'Bicep tendon', platform: 'instagram',
          edit_diff: {
            changed: true, lengthDelta: -120, lengthDeltaPct: -9,
            removedPhrases: ['retract'], addedPhrases: ['move'],
            hashtags: { removed: [], added: [] }, links: { removed: [], added: [] },
          },
        },
      ],
    })
    expect(html).toContain('1 draft edited before approving')
    expect(html).toContain('Bicep tendon')
    expect(html).toContain('-120 chars')
    expect(text).toContain('Edited before approving: 1')
  })

  it('skips edit-diff entries whose diff did not actually change anything', () => {
    const { html } = buildDigest({
      ...BASE,
      editDiffs: [{ id: '1', topic: 'X', platform: 'gbp', edit_diff: { changed: false } }],
    })
    // entries array is non-empty so the section header still renders, but no
    // per-item line for a no-op diff
    expect(html).toContain('1 draft edited before approving')
    expect(html).not.toContain('X — ')
  })
})
