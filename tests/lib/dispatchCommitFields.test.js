import { describe, it, expect } from 'vitest'
import { dispatchCommitFields } from '../../api/_routes/publish/social.js'

// dispatchCommitFields is the server-authoritative write the publish route makes
// in the SAME sb-direct PATCH that releases the dispatch claim. It exists because
// the client used to echo these columns via /api/db/content — the publish lock's
// route — and by then the row is already 'scheduled', so the echo 409'd (the
// false "Post failed" / locked_scheduled bug, feedback 2026-08-04). Moving the
// whole commit here bypasses the lock, and also fixes platform_post_id, which the
// client echo never landed (it 409'd first) — leaving the post.published webhook,
// which matches on that id, unable to promote the row.
const NOW = '2026-08-04T18:37:40.000Z'

describe('dispatchCommitFields — status + scheduled_at + post id, committed server-side', () => {
  it('always commits status=scheduled (bundle promotes to posted via webhook, not here)', () => {
    expect(dispatchCommitFields({ postId: 'p1' }, null, NOW).status).toBe('scheduled')
  })

  it('persists the bundle post id when the provider returned one', () => {
    expect(dispatchCommitFields({ postId: 'bundle-123' }, null, NOW).platform_post_id).toBe('bundle-123')
  })

  it('omits platform_post_id when the provider returned none, so an existing id is never nulled', () => {
    expect(dispatchCommitFields({ postId: null }, null, NOW)).not.toHaveProperty('platform_post_id')
    expect(dispatchCommitFields({}, null, NOW)).not.toHaveProperty('platform_post_id')
  })

  it('prefers an explicit schedule time over the provider slot and the now fallback', () => {
    const explicit = '2026-09-09T12:00:00.000Z'
    const out = dispatchCommitFields({ scheduledAt: '2026-08-05T00:00:00.000Z' }, explicit, NOW)
    expect(out.scheduled_at).toBe(explicit)
  })

  it('falls back to the provider slot, then to now, when no explicit time is given', () => {
    expect(dispatchCommitFields({ scheduledAt: '2026-08-05T00:00:00.000Z' }, null, NOW).scheduled_at)
      .toBe('2026-08-05T00:00:00.000Z')
    // scheduled_at MUST be non-null even for publish-now: the hourly
    // sync-published-status backstop only picks up rows whose scheduled_at is set.
    expect(dispatchCommitFields({}, null, NOW).scheduled_at).toBe(NOW)
  })
})
