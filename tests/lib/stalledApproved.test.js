import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { filterStalledApproved, shapeStalledApproved, STALL_GRACE_MS } from '../../api/_lib/stalledApproved.js'

// The /week "approved, but never published" strip exists because the first
// reel approval in product history (f172b617, 2026-08-17) stalled one click
// short of publish and nothing surfaced it. These tests pin the stall rule —
// what counts as stalled, what belongs to another lane, and the grace
// boundary — against the shape of the real incident rows.

const NOW = Date.parse('2026-08-21T12:00:00Z')
const DAYS = (n) => n * 24 * 60 * 60 * 1000

// The real incident row's shape (f172b617): approved 08-17, video media.
const reelRow = (over = {}) => ({
  id: 'f172b617',
  platform: 'instagram',
  format: 'reel',
  status: 'approved',
  topic: 'First reel',
  staff_name: 'Philip',
  approved_at: new Date(NOW - DAYS(4)).toISOString(),
  scheduled_at: null,
  published_at: null,
  media_urls: [{ url: 'https://blob/clip.mp4', type: 'video', kind: 'video' }],
  ...over,
})

describe('filterStalledApproved — what counts as stalled', () => {
  it('includes an approved, unscheduled social post older than the grace period', () => {
    const out = filterStalledApproved([reelRow()], NOW)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'f172b617',
      platform: 'instagram',
      format: 'reel',
      staffName: 'Philip',
      daysStalled: 4,
      hasVideo: true,
    })
  })

  it('excludes rows inside the grace period, includes exactly at the boundary', () => {
    const fresh = reelRow({ approved_at: new Date(NOW - STALL_GRACE_MS + 60_000).toISOString() })
    const boundary = reelRow({ id: 'b', approved_at: new Date(NOW - STALL_GRACE_MS).toISOString() })
    expect(filterStalledApproved([fresh], NOW)).toHaveLength(0)
    expect(filterStalledApproved([boundary], NOW)).toHaveLength(1)
  })

  it('excludes lanes with their own strip or no social publish path', () => {
    const rows = ['blog', 'email', 'landing_page', 'googleAds'].map((platform, i) =>
      reelRow({ id: `p${i}`, platform }))
    expect(filterStalledApproved(rows, NOW)).toHaveLength(0)
    // …and the exclusion is the platform, not something else about the row:
    expect(filterStalledApproved([reelRow({ platform: 'facebook' })], NOW)).toHaveLength(1)
  })

  it('excludes rows that did get their last click — scheduled or published', () => {
    expect(filterStalledApproved([reelRow({ scheduled_at: '2026-08-20T09:00:00Z' })], NOW)).toHaveLength(0)
    expect(filterStalledApproved([reelRow({ published_at: '2026-08-20T09:00:00Z', status: 'published' })], NOW)).toHaveLength(0)
  })

  it('only counts approved rows — the broad route query must not widen the rule', () => {
    for (const status of ['draft', 'in_review', 'scheduled', 'published', 'failed', 'rejected']) {
      expect(filterStalledApproved([reelRow({ status })], NOW)).toHaveLength(0)
    }
  })

  it('drops rows with no approved_at (age is unknowable) and tolerates junk input', () => {
    expect(filterStalledApproved([reelRow({ approved_at: null })], NOW)).toHaveLength(0)
    expect(filterStalledApproved(null, NOW)).toEqual([])
    expect(filterStalledApproved([null, undefined], NOW)).toEqual([])
  })
})

describe('shapeStalledApproved — client contract', () => {
  it('maps snake_case columns and nulls the blanks', () => {
    const out = shapeStalledApproved({ id: 'x', media_urls: null, approved_at: null }, NOW)
    expect(out).toEqual({
      id: 'x',
      platform: null,
      format: null,
      topic: null,
      staffName: null,
      approvedAt: null,
      daysStalled: 0,
      hasVideo: false,
    })
  })

  it('flags video by either type or kind (canonical media_urls carries both, older rows may not)', () => {
    expect(shapeStalledApproved(reelRow({ media_urls: [{ url: 'u', kind: 'video' }] }), NOW).hasVideo).toBe(true)
    expect(shapeStalledApproved(reelRow({ media_urls: [{ url: 'u', type: 'video' }] }), NOW).hasVideo).toBe(true)
    expect(shapeStalledApproved(reelRow({ media_urls: [{ url: 'u', type: 'image' }] }), NOW).hasVideo).toBe(false)
  })
})

describe('route wiring — week-summary actually calls the shared rule', () => {
  // A green unit suite over the helper proves nothing if the route stops
  // calling it (the "tests test their own copy" failure). Pin the wiring.
  const src = fs.readFileSync(new URL('../../api/_routes/content-plan/week-summary.js', import.meta.url), 'utf8')
  it('imports and calls filterStalledApproved and returns stalledApproved', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/_lib\/stalledApproved\.js'/)
    expect(src).toMatch(/filterStalledApproved\(/)
    expect(src).toMatch(/stalledApproved,/)
  })
})
