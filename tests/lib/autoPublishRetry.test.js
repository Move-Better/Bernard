import { describe, it, expect } from 'vitest'
import {
  MAX_AUTO_PUBLISH_RETRIES,
  unpostedTargets,
  mergePostedLocations,
  isChannelComplete,
  decideClaimDisposition,
} from '../../api/_lib/autoPublishRetry.js'

const NOW = '2026-06-27T00:00:00.000Z'
const LATER = '2026-06-27T00:10:00.000Z'

// Two GBP locations, stable ids matching how the cron keys them.
const TARGETS = [{ id: 'locA' }, { id: 'locB' }]

describe('unpostedTargets — the skip-if-already-posted guard', () => {
  it('returns all targets on first run (no posted locations)', () => {
    expect(unpostedTargets(TARGETS, undefined).map((t) => t.id)).toEqual(['locA', 'locB'])
    expect(unpostedTargets(TARGETS, { locations: {} }).map((t) => t.id)).toEqual(['locA', 'locB'])
  })

  it('skips a location already recorded as posted — never re-dispatched', () => {
    const state = { locations: { locA: { post_id: 'p1', fired_at: NOW } } }
    expect(unpostedTargets(TARGETS, state).map((t) => t.id)).toEqual(['locB'])
  })

  it('returns empty when every target is already posted', () => {
    const state = { locations: { locA: {}, locB: {} } }
    expect(unpostedTargets(TARGETS, state)).toEqual([])
  })

  it('tolerates non-array / nullish targets', () => {
    expect(unpostedTargets(null, { locations: { locA: {} } })).toEqual([])
    expect(unpostedTargets(undefined, undefined)).toEqual([])
  })
})

describe('mergePostedLocations — monotonic append-only posted-set', () => {
  it('adds newly-posted locations with post_id + fired_at', () => {
    const merged = mergePostedLocations({ locations: {} }, [{ id: 'locA', postId: 'p1' }], NOW)
    expect(merged.locations).toEqual({ locA: { post_id: 'p1', fired_at: NOW } })
  })

  it('NEVER overwrites an existing posted record (idempotent across retries)', () => {
    const prior = { locations: { locA: { post_id: 'p1', fired_at: NOW } } }
    // A retry run re-reports locA (should be impossible since it is skipped, but
    // defend anyway) plus the genuinely-new locB.
    const merged = mergePostedLocations(prior, [
      { id: 'locA', postId: 'DIFFERENT' },
      { id: 'locB', postId: 'p2' },
    ], LATER)
    expect(merged.locations.locA).toEqual({ post_id: 'p1', fired_at: NOW }) // unchanged
    expect(merged.locations.locB).toEqual({ post_id: 'p2', fired_at: LATER })
  })

  it('preserves sibling state keys (content_item_id, buffer_id) on the channel', () => {
    const prior = { content_item_id: 'ci1', buffer_id: 'b1', locations: { locA: { post_id: 'p1' } } }
    const merged = mergePostedLocations(prior, [{ id: 'locB', postId: 'p2' }], LATER)
    expect(merged.content_item_id).toBe('ci1')
    expect(merged.buffer_id).toBe('b1')
    expect(Object.keys(merged.locations)).toEqual(['locA', 'locB'])
  })

  it('ignores malformed posted entries (no id)', () => {
    const merged = mergePostedLocations({ locations: {} }, [null, { postId: 'x' }, { id: 'locA' }], NOW)
    expect(Object.keys(merged.locations)).toEqual(['locA'])
    expect(merged.locations.locA.post_id).toBeNull()
  })
})

describe('isChannelComplete — all targets posted AND bookkeeping done', () => {
  it('false when a target is still unposted', () => {
    const state = { content_item_id: 'ci1', locations: { locA: {} } }
    expect(isChannelComplete(TARGETS, state)).toBe(false)
  })

  it('false when all posted but content_item_id missing (keeps marking retriable)', () => {
    const state = { locations: { locA: {}, locB: {} } } // no content_item_id
    expect(isChannelComplete(TARGETS, state)).toBe(false)
  })

  it('true when all targets posted and content_item_id present', () => {
    const state = { content_item_id: 'ci1', locations: { locA: {}, locB: {} } }
    expect(isChannelComplete(TARGETS, state)).toBe(true)
  })

  it('false for an empty target list (nothing to be complete about)', () => {
    expect(isChannelComplete([], { content_item_id: 'ci1', locations: {} })).toBe(false)
  })
})

describe('decideClaimDisposition — release (retry) vs retain', () => {
  it('retains the claim when everything is complete', () => {
    expect(decideClaimDisposition({ allComplete: true, anyRetriable: false, retryCount: 1 }))
      .toEqual({ release: false, exhausted: false })
  })

  it('releases the claim to retry when retriable work remains within budget', () => {
    expect(decideClaimDisposition({ allComplete: false, anyRetriable: true, retryCount: 1 }))
      .toEqual({ release: true, exhausted: false })
  })

  it('retains the claim when only permanent (config) blocks remain — no infinite retry', () => {
    expect(decideClaimDisposition({ allComplete: false, anyRetriable: false, retryCount: 1 }))
      .toEqual({ release: false, exhausted: false })
  })

  it('retains + marks exhausted once the retry budget is spent', () => {
    expect(decideClaimDisposition({ allComplete: false, anyRetriable: true, retryCount: MAX_AUTO_PUBLISH_RETRIES }))
      .toEqual({ release: false, exhausted: true })
    // One below the cap still retries.
    expect(decideClaimDisposition({ allComplete: false, anyRetriable: true, retryCount: MAX_AUTO_PUBLISH_RETRIES - 1 }))
      .toEqual({ release: true, exhausted: false })
  })
})

describe('end-to-end partial-failure → retry → completion (no double-post)', () => {
  it('locA posts, locB fails, retries only locB, then completes', () => {
    // ---- Run 1: dispatch both, locA succeeds, locB fails. ----
    let channelState = { locations: {} }
    let pending = unpostedTargets(TARGETS, channelState)
    expect(pending.map((t) => t.id)).toEqual(['locA', 'locB'])

    // Simulate dispatch result: locA posted, locB failed.
    channelState = mergePostedLocations(channelState, [{ id: 'locA', postId: 'pA' }], NOW)
    channelState.content_item_id = 'ci1' // ci marked on first post
    expect(isChannelComplete(TARGETS, channelState)).toBe(false)
    let disp = decideClaimDisposition({ allComplete: false, anyRetriable: true, retryCount: 1 })
    expect(disp.release).toBe(true) // re-armed for retry

    // ---- Run 2: only locB is pending; locA is NEVER re-dispatched. ----
    pending = unpostedTargets(TARGETS, channelState)
    expect(pending.map((t) => t.id)).toEqual(['locB']) // <-- the core guard

    // locB now succeeds.
    channelState = mergePostedLocations(channelState, [{ id: 'locB', postId: 'pB' }], LATER)
    expect(isChannelComplete(TARGETS, channelState)).toBe(true)
    disp = decideClaimDisposition({ allComplete: true, anyRetriable: false, retryCount: 2 })
    expect(disp.release).toBe(false) // claim retained — done

    // locA kept its original post_id throughout (never re-posted).
    expect(channelState.locations.locA).toEqual({ post_id: 'pA', fired_at: NOW })
    expect(channelState.locations.locB).toEqual({ post_id: 'pB', fired_at: LATER })
  })
})
