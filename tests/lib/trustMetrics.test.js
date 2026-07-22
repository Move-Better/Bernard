import { describe, it, expect } from 'vitest'
import { computeTrustMetrics } from '../../api/_lib/trustMetrics.js'

// mockSb returns rejectedRows for the first call (status=rejected) and
// decidedRows for the second (status in approved/scheduled/published) —
// matches the Promise.all([rejRes, decRes]) call order in computeTrustMetrics.
function mockSb(rejectedRows, decidedRows) {
  let call = 0
  return async () => {
    call += 1
    const rows = call === 1 ? rejectedRows : decidedRows
    return { ok: true, json: async () => rows }
  }
}

describe('computeTrustMetrics', () => {
  it('returns an empty object with no wsId', async () => {
    expect(await computeTrustMetrics(null, mockSb([], []))).toEqual({})
  })

  it('computes reject-rate and edit-rate per platform', async () => {
    const rejected = [
      { platform: 'instagram', edit_diff: null },
      { platform: 'instagram', edit_diff: null },
    ]
    const decided = [
      { platform: 'instagram', edit_diff: { changed: true } },
      { platform: 'instagram', edit_diff: { changed: false } },
      { platform: 'instagram', edit_diff: null },
      { platform: 'instagram', edit_diff: { changed: true } },
      { platform: 'instagram', edit_diff: null },
      { platform: 'instagram', edit_diff: null },
      { platform: 'instagram', edit_diff: null },
      { platform: 'instagram', edit_diff: null },
    ]
    const result = await computeTrustMetrics('ws-1', mockSb(rejected, decided))
    // 8 approved + 2 rejected = 10 decided; 2/10 = 0.2 reject rate
    expect(result.instagram.sampleCount).toBe(10)
    expect(result.instagram.rejectRate).toBeCloseTo(0.2, 2)
    // 2 of 8 approved were edited = 0.25 edit rate
    expect(result.instagram.editRate).toBeCloseTo(0.25, 2)
  })

  it('keeps platforms independent', async () => {
    const rejected = [{ platform: 'facebook', edit_diff: null }]
    const decided = [
      { platform: 'instagram', edit_diff: { changed: true } },
      { platform: 'facebook', edit_diff: null },
    ]
    const result = await computeTrustMetrics('ws-1', mockSb(rejected, decided))
    expect(result.instagram.rejectRate).toBe(0)
    expect(result.instagram.editRate).toBe(1)
    expect(result.facebook.rejectRate).toBe(0.5)
    expect(result.facebook.editRate).toBe(0)
  })

  it('returns null editRate when nothing was approved (all rejected)', async () => {
    const rejected = [{ platform: 'linkedin', edit_diff: null }]
    const result = await computeTrustMetrics('ws-1', mockSb(rejected, []))
    expect(result.linkedin.rejectRate).toBe(1)
    expect(result.linkedin.editRate).toBeNull()
  })

  it('returns an empty object for a platform with zero activity', async () => {
    const result = await computeTrustMetrics('ws-1', mockSb([], []))
    expect(result).toEqual({})
  })
})
