// A producer retry of a publish-now post wrote status 'published' the moment
// bundle.social accepted it. bundle always creates the post SCHEDULED and
// promotes it itself, and the post.published webhook only promotes rows that
// are status=eq.scheduled, so published_at and the live URL never landed; a
// post that later errored stayed "published"; and the hourly backstop, which
// reconciles only scheduled rows, never looked at it. social.js was fixed for
// this (dispatchCommitFields); the retry path was not (audit 2026-11-18, full).

import { describe, it, expect, vi } from 'vitest'

vi.mock('@vercel/blob', () => ({ put: vi.fn(), del: vi.fn() }))

const { retryCommitPatch } = await import('../../api/_routes/producer/retry-publish.js')

const NOW = '2026-11-18T20:00:00.000Z'

describe('retryCommitPatch', () => {
  it('commits a publish-now retry as scheduled with a real timestamp, never published', () => {
    const p = retryCommitPatch({ postId: 'bp_1' }, null, NOW)
    expect(p.status).toBe('scheduled')
    expect(p.scheduled_at).toBe(NOW)
    expect(p).not.toHaveProperty('published_at')
    expect(p.platform_post_id).toBe('bp_1')
  })

  it('uses the provider-echoed time when bundle returns one', () => {
    const p = retryCommitPatch({ postId: 'bp_1', scheduledAt: '2026-11-18T20:01:00.000Z' }, null, NOW)
    expect(p.scheduled_at).toBe('2026-11-18T20:01:00.000Z')
  })

  it('keeps a future slot for a scheduled retry', () => {
    const slot = '2026-11-20T17:00:00.000Z'
    const p = retryCommitPatch({ postId: 'bp_2' }, slot, NOW)
    expect(p.status).toBe('scheduled')
    expect(p.scheduled_at).toBe(slot)
  })

  it('releases the claim and clears the error in the same write', () => {
    const p = retryCommitPatch({ postId: 'bp_1' }, null, NOW)
    expect(p.dispatching_at).toBeNull()
    expect(p.publish_error).toBeNull()
  })

  it('never nulls an existing post id when the provider returned none', () => {
    expect(retryCommitPatch({}, null, NOW)).not.toHaveProperty('platform_post_id')
  })
})
