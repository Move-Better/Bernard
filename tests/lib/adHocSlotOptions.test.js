// Cover for the ad-hoc add-to-day options behind /week's per-day "Add post".
//
// The bug this closes: computeEmptySlots can only ever offer slots the cadence
// TEMPLATE defines, so a day whose slots were all filled offered nothing — the
// board's only add-affordance disappeared exactly when the day was busiest.
// Reported 2026-07-23 ("Unable to schedule new posts today (Thursday)") on a
// week where Thursday had exactly one pinned slot and it was taken.
import { describe, it, expect } from 'vitest'
import { adHocSlotOptions, computeEmptySlots } from '../../src/lib/postingSlots.js'

// Move Better's real cadence at the time of the report, in week-summary shape.
const CADENCE = {
  facebook: { enabled: true, slots: [
    { weekday: 'mon', hour: 12, format: 'post' },
    { weekday: 'wed', hour: 12, format: 'post' },
    { weekday: 'fri', hour: 12, format: 'post' },
  ] },
  gbp: { enabled: true, slots: [
    { weekday: 'mon', hour: 8, format: 'post' },
    { weekday: 'fri', hour: 8, format: 'post' },
  ] },
  instagram: { enabled: true, slots: [
    { weekday: 'mon', hour: 12, format: 'post' },
    { weekday: 'mon', hour: 13, format: 'reel' },
    { weekday: 'tue', hour: 12, format: 'reel' },
    { weekday: 'wed', hour: 12, format: 'reel' },
    { weekday: 'thu', hour: 12, format: 'reel' },
    { weekday: 'fri', hour: 12, format: 'reel' },
  ] },
  linkedin: { enabled: true, slots: [
    { weekday: 'mon', hour: 7, format: 'post' },
    { weekday: 'wed', hour: 7, format: 'post' },
    { weekday: 'fri', hour: 7, format: 'post' },
  ] },
  instagram_story: { enabled: false, slots: [] },
}

const key = (o) => `${o.platform}:${o.format}`

describe('the reported Thursday case', () => {
  it('computeEmptySlots offers nothing on Thursday once its one slot is filled', () => {
    // The single thu slot (instagram/12/reel) taken — this is what produced a
    // Thursday column with no "+ Open slot" card at all.
    const scheduled = [{ platform: 'instagram', format: 'reel', scheduled_at: '2026-07-23T19:00:00.000Z' }]
    const empty = computeEmptySlots(CADENCE, scheduled, 'America/Los_Angeles')
    expect(empty.filter((s) => s.weekday === 'thu')).toHaveLength(0)
  })

  it('adHocSlotOptions still offers every enabled channel, so the day is reachable', () => {
    // Independent of weekday and of what is already scheduled — that is the fix.
    const opts = adHocSlotOptions(CADENCE)
    expect(opts.length).toBeGreaterThan(0)
    expect(new Set(opts.map((o) => o.platform))).toEqual(
      new Set(['facebook', 'gbp', 'instagram', 'linkedin']),
    )
  })
})

describe('adHocSlotOptions', () => {
  it('omits disabled channels', () => {
    expect(adHocSlotOptions(CADENCE).some((o) => o.platform === 'instagram_story')).toBe(false)
  })

  it('offers each format a channel actually posts in, not just one per channel', () => {
    // Instagram runs both a post lane and a reel lane; collapsing to one would
    // make the other unreachable from the board.
    const ig = adHocSlotOptions(CADENCE).filter((o) => o.platform === 'instagram')
    expect(new Set(ig.map((o) => o.format))).toEqual(new Set(['post', 'reel']))
    expect(adHocSlotOptions(CADENCE).filter((o) => key(o) === 'linkedin:post')).toHaveLength(1)
  })

  it("copies each channel's own most-used hour", () => {
    const byKey = Object.fromEntries(adHocSlotOptions(CADENCE).map((o) => [key(o), o.hour]))
    expect(byKey['linkedin:post']).toBe(7)   // 7 on all three of its days
    expect(byKey['gbp:post']).toBe(8)
    expect(byKey['facebook:post']).toBe(12)
    expect(byKey['instagram:reel']).toBe(12) // 12 on 4 days, 13 on one
  })

  it('falls back to midday for an enabled channel with no pinned slots', () => {
    // Turning a channel on without pinning it a time must not make it
    // unreachable — it just has no configured hour to copy.
    const opts = adHocSlotOptions({ tiktok: { enabled: true, slots: [] } })
    expect(opts).toEqual([{ platform: 'tiktok', format: 'post', hour: 12 }])
  })

  it('ignores individually disabled slots when deriving formats and hours', () => {
    const opts = adHocSlotOptions({
      instagram: { enabled: true, slots: [
        { weekday: 'mon', hour: 9, format: 'post' },
        { weekday: 'tue', hour: 20, format: 'reel', enabled: false },
      ] },
    })
    expect(opts).toEqual([{ platform: 'instagram', format: 'post', hour: 9 }])
  })

  it('is stable across calls and null-safe', () => {
    expect(adHocSlotOptions(CADENCE)).toEqual(adHocSlotOptions(CADENCE))
    expect(adHocSlotOptions(null)).toEqual([])
    expect(adHocSlotOptions(undefined)).toEqual([])
    expect(adHocSlotOptions({})).toEqual([])
  })
})
