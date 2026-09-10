import { describe, it, expect } from 'vitest'
import { findRecentPublishMatch } from '../../src/lib/recentPublishMatch.js'

// feedback c4b8f7c9 follow-up: flag a queued blog whose author was also one
// of the last 2 published — matched by staff_id, never by the display name
// (which can legitimately drift; see approvedBlogs.js).

const ZACH_ID = '4dc8770f-fde4-43b5-8095-70412ecd8506'
const WHITNEY_ID = '596542ff-36c8-4f59-b828-5ac1d69c3a26'
const TYLER_ID = '9ad92a24-34ab-42cc-8cf4-74f582a2e504'

describe('findRecentPublishMatch', () => {
  it('matches by staff_id even when the display name has drifted', () => {
    // The real live case: same person, two different name snapshots.
    const blog = { staffId: ZACH_ID, staffName: 'Dr. Zachary Cullen' }
    const recentlyPublished = [
      { staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-09-06T21:33:10Z' },
      { staffId: WHITNEY_ID, staffName: 'Whitney Phillips', publishedAt: '2026-08-30T17:56:01Z' },
    ]
    expect(findRecentPublishMatch(blog, recentlyPublished)).toEqual({
      publishedAt: '2026-09-06T21:33:10Z',
      staffName: 'Zach Cullen',
      sameName: false,
    })
  })

  it('marks sameName true when the spelling actually agrees', () => {
    const blog = { staffId: WHITNEY_ID, staffName: 'Whitney Phillips' }
    const recentlyPublished = [
      { staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-09-06T21:33:10Z' },
      { staffId: WHITNEY_ID, staffName: 'Whitney Phillips', publishedAt: '2026-08-30T17:56:01Z' },
    ]
    expect(findRecentPublishMatch(blog, recentlyPublished)).toEqual({
      publishedAt: '2026-08-30T17:56:01Z',
      staffName: 'Whitney Phillips',
      sameName: true,
    })
  })

  it('treats a case/whitespace-only difference as the same name', () => {
    const blog = { staffId: WHITNEY_ID, staffName: '  whitney phillips  ' }
    const recentlyPublished = [{ staffId: WHITNEY_ID, staffName: 'Whitney Phillips', publishedAt: '2026-08-30T17:56:01Z' }]
    expect(findRecentPublishMatch(blog, recentlyPublished)?.sameName).toBe(true)
  })

  it('returns null when no recent publish matches this staff_id', () => {
    const blog = { staffId: TYLER_ID, staffName: 'Dr. Tyler' }
    const recentlyPublished = [
      { staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-09-06T21:33:10Z' },
      { staffId: WHITNEY_ID, staffName: 'Whitney Phillips', publishedAt: '2026-08-30T17:56:01Z' },
    ]
    expect(findRecentPublishMatch(blog, recentlyPublished)).toBeNull()
  })

  it('returns null when the blog has no staff_id at all — never falls back to name matching', () => {
    const blog = { staffId: null, staffName: 'Zach Cullen' }
    const recentlyPublished = [{ staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-09-06T21:33:10Z' }]
    expect(findRecentPublishMatch(blog, recentlyPublished)).toBeNull()
  })

  it('returns null on a missing or empty recentlyPublished list', () => {
    const blog = { staffId: ZACH_ID, staffName: 'Zach Cullen' }
    expect(findRecentPublishMatch(blog, [])).toBeNull()
    expect(findRecentPublishMatch(blog, null)).toBeNull()
    expect(findRecentPublishMatch(blog, undefined)).toBeNull()
  })

  it('picks the FIRST (most recent) match when the same person appears twice in recentlyPublished', () => {
    // The exact live scenario: last two publishes were both Zach Cullen.
    const blog = { staffId: ZACH_ID, staffName: 'Zach Cullen' }
    const recentlyPublished = [
      { staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-09-06T21:33:10Z' },
      { staffId: ZACH_ID, staffName: 'Zach Cullen', publishedAt: '2026-08-28T00:20:21Z' },
    ]
    expect(findRecentPublishMatch(blog, recentlyPublished)?.publishedAt).toBe('2026-09-06T21:33:10Z')
  })
})
