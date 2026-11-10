import { describe, it, expect } from 'vitest'
import { ownApprovalItems } from '../../src/lib/ownApprovals.js'

// The team-member home's "Waiting on your OK" (Q, 2026-11-09): only the
// person's own approvals, blogs first, then answers, word sign-offs, updates.

const NOW = Date.parse('2026-11-09T12:00:00Z')

describe('ownApprovalItems', () => {
  it('orders blogs, then answers, then words, then updates, whatever the input order', () => {
    // Fed in the WRONG order on purpose: words and the answer arrive first, so
    // a passing result can only mean the sort moved them.
    const items = ownApprovalItems({
      now: NOW,
      supersessions: [{ id: 'u1', summary: 'Changed view', created_at: '2026-10-01' }],
      wordsApprovals: [{ id: 'w1', topic: 'The Repetition Problem', created_at: '2026-10-07' }],
      yourAnswerReview: [{ id: 'a1', question: 'When to push?', created_at: '2026-07-04' }],
      yourReview: [{ id: 'b1', topic: 'First Visit', created_at: '2026-08-19' }],
    })
    expect(items.map((i) => i.kind)).toEqual(['blog', 'answer', 'words', 'supersession'])
  })

  it('oldest first inside a kind', () => {
    const items = ownApprovalItems({
      now: NOW,
      yourReview: [
        { id: 'new', topic: 'Newer', created_at: '2026-10-07' },
        { id: 'old', topic: 'Older', created_at: '2026-06-18' },
      ],
    })
    expect(items.map((i) => i.key)).toEqual(['blog:old', 'blog:new'])
  })

  it('a blog row links straight to the draft, not to a list', () => {
    const [blog] = ownApprovalItems({ now: NOW, yourReview: [{ id: 'b1', topic: 'X', created_at: '2026-08-19' }] })
    expect(blog.to).toBe('/publish/b1')
  })

  it('never contains clinic-wide rows: no overdue staff, no other people\'s posts', () => {
    const items = ownApprovalItems({ now: NOW })
    expect(items).toEqual([])
  })
})
