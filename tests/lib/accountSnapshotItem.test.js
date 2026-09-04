import { describe, it, expect } from 'vitest'
import { mapAccountSnapshotItem } from '../../api/_lib/social/bundlePublisher.js'

// Every value distinct on purpose: a mutation that swaps two field mappings
// (impressions read from views, likes from comments, …) must change the
// output. A symmetric fixture would pass either implementation.
const FULL = {
  createdAt: '2026-08-05T00:25:18.836Z',
  postCount: 200,
  followers: 628,
  impressions: 8162,
  impressionsUnique: 7900,
  views: 135,
  viewsUnique: 12,
  likes: 167,
  comments: 3,
  // bundle fields we deliberately do NOT persist:
  id: 'itm_1',
  socialAccountId: 'acc_1',
  following: 41,
  forced: false,
}

describe('mapAccountSnapshotItem — bundle item → snapshot row shape', () => {
  it('maps every persisted field from its own source field', () => {
    expect(mapAccountSnapshotItem(FULL)).toEqual({
      at: '2026-08-05T00:25:18.836Z',
      postCount: 200,
      followers: 628,
      impressions: 8162,
      impressionsUnique: 7900,
      views: 135,
      viewsUnique: 12,
      likes: 167,
      comments: 3,
    })
  })

  it('turns non-finite values into null (the "platform didn\'t report" marker), never NaN/undefined', () => {
    const out = mapAccountSnapshotItem({
      createdAt: '2026-08-06T00:00:00Z',
      postCount: null,
      followers: undefined,
      impressions: NaN,
      impressionsUnique: 'not-a-number',
      // views/viewsUnique/likes/comments absent entirely
    })
    expect(out).toEqual({
      at: '2026-08-06T00:00:00Z',
      postCount: null,
      followers: null,
      impressions: null,
      impressionsUnique: null,
      views: null,
      viewsUnique: null,
      likes: null,
      comments: null,
    })
  })

  it('keeps a real zero as 0, distinct from absence', () => {
    // viewsUnique is 0 on every observed IG item — that is a reported value,
    // not a gap, and must not collapse into null.
    expect(mapAccountSnapshotItem({ ...FULL, viewsUnique: 0 }).viewsUnique).toBe(0)
  })

  it('survives a missing/empty item with at:null (callers filter on at)', () => {
    expect(mapAccountSnapshotItem(undefined).at).toBe(null)
    expect(mapAccountSnapshotItem({}).at).toBe(null)
  })
})
