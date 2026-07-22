import { describe, it, expect } from 'vitest'
import { reelTargetForWorkspace } from '../../api/_lib/reelFactory.js'

const ws = (channels) => ({ cadence_policy: { channels } })

describe('reelTargetForWorkspace', () => {
  it('derives 3 of 4 from a default Instagram cadence', () => {
    // The live movebetter shape: instagram 4/week, no explicit reel target.
    expect(reelTargetForWorkspace(ws({ instagram: { target_per_week: 4, enabled: true } }))).toBe(3)
  })

  it('never proposes more reels than the Instagram target itself', () => {
    expect(reelTargetForWorkspace(ws({ instagram: { target_per_week: 1, enabled: true } }))).toBe(1)
  })

  it('an explicit instagram_reel target wins over the derived share', () => {
    expect(
      reelTargetForWorkspace(
        ws({ instagram: { target_per_week: 4, enabled: true }, instagram_reel: { target_per_week: 1 } }),
      ),
    ).toBe(1)
  })

  it('an explicit 0 is how a workspace opts out entirely', () => {
    // Must NOT fall through to the derived share — 0 is a real answer, and the
    // falsy check that would swallow it is the easy bug here.
    expect(
      reelTargetForWorkspace(
        ws({ instagram: { target_per_week: 4, enabled: true }, instagram_reel: { target_per_week: 0 } }),
      ),
    ).toBe(0)
  })

  it('respects enabled:false on the reel channel', () => {
    expect(
      reelTargetForWorkspace(
        ws({ instagram: { target_per_week: 4, enabled: true }, instagram_reel: { target_per_week: 3, enabled: false } }),
      ),
    ).toBe(0)
  })

  it('returns 0 when Instagram is absent or disabled', () => {
    expect(reelTargetForWorkspace(ws({ linkedin: { target_per_week: 3, enabled: true } }))).toBe(0)
    expect(reelTargetForWorkspace(ws({ instagram: { target_per_week: 4, enabled: false } }))).toBe(0)
    expect(reelTargetForWorkspace(ws({ instagram: { target_per_week: 0, enabled: true } }))).toBe(0)
  })

  it('is safe on a workspace with no cadence policy at all', () => {
    expect(reelTargetForWorkspace({})).toBe(0)
    expect(reelTargetForWorkspace(null)).toBe(0)
  })
})

describe('reelTargetForWorkspace — formats namespace', () => {
  const wsf = (channels, formats) => ({ cadence_policy: { channels, formats } })
  const IG4 = { instagram: { target_per_week: 4, enabled: true } }

  it('an explicit formats.reel target wins over the derived share', () => {
    expect(reelTargetForWorkspace(wsf(IG4, { reel: { target_per_week: 2 } }))).toBe(2)
  })

  it('an explicit 0 in formats turns auto-drafted Reels off', () => {
    expect(reelTargetForWorkspace(wsf(IG4, { reel: { target_per_week: 0 } }))).toBe(0)
  })

  it('clamps the reel target to the Instagram target — a subset cannot exceed its set', () => {
    // The whole reason formats is separate from channels: reels come OUT of the
    // Instagram allowance, they are not added on top of it.
    expect(reelTargetForWorkspace(wsf(IG4, { reel: { target_per_week: 9 } }))).toBe(4)
  })

  it('formats wins over the legacy channels.instagram_reel key', () => {
    expect(
      reelTargetForWorkspace({
        cadence_policy: {
          channels: { ...IG4, instagram_reel: { target_per_week: 1 } },
          formats: { reel: { target_per_week: 3 } },
        },
      }),
    ).toBe(3)
  })

  it('still honours a legacy channels.instagram_reel row written before formats existed', () => {
    expect(reelTargetForWorkspace(wsf({ ...IG4, instagram_reel: { target_per_week: 1 } }, undefined))).toBe(1)
  })

  it('returns 0 when Instagram is off, whatever formats says', () => {
    expect(reelTargetForWorkspace(wsf({ instagram: { target_per_week: 4, enabled: false } }, { reel: { target_per_week: 3 } }))).toBe(0)
  })
})
