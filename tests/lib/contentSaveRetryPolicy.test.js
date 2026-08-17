import { describe, it, expect } from 'vitest'
import { ApiError } from '../../src/lib/apiError.js'
import {
  CONTENT_SAVE_MAX_RETRIES,
  shouldRetryContentSave,
  contentSaveRetryDelay,
  suppressContentSaveToast,
} from '../../src/lib/queries.js'

// A publish-lock rejection is a 409 whose payload.error is a lock reason key —
// not any 409 (isLockRejection matches on the reason, not the status alone).
const lockError = (reason = 'locked_scheduled') => new ApiError('locked', 409, { error: reason })

// Guards the retry + toast-routing policy for a content_items save
// (useUpdateContentItem). Two real reports shaped this budget — movebetter
// 2026-08-05 (repeated hard "Update failed" during a 5xx window) and
// movebetter/Philip 2026-08-17 (feedback 9b080c3e: a single caption PATCH's
// transient 5xx outlasted the old 2-retry budget). Getting any of these wrong is
// harmful:
//   - too few retries → a several-second blip dead-ends the editor;
//   - retrying a 4xx → wasted round-trips against a server that will always
//     refuse (and, on the 409 storm, a toast per debounce window);
//   - suppressing a real 4xx/bug → a genuine error is silently swallowed.

describe('shouldRetryContentSave', () => {
  it('retries transient 5xx / network failures across the whole budget (attempts 0..3)', () => {
    for (const failureCount of [0, 1, 2, 3]) {
      expect(shouldRetryContentSave(failureCount, new ApiError('boom', 503, {}))).toBe(true)
      expect(shouldRetryContentSave(failureCount, new TypeError('Failed to fetch'))).toBe(true)
    }
  })

  it('stops after 4 retries — the 5th failure is NOT retried', () => {
    expect(CONTENT_SAVE_MAX_RETRIES).toBe(4)
    expect(shouldRetryContentSave(4, new ApiError('boom', 503, {}))).toBe(false)
    expect(shouldRetryContentSave(9, new ApiError('boom', 500, {}))).toBe(false)
  })

  it('never retries a deliberate 4xx, even on the first failure', () => {
    // 409 publish lock, 400 validation, 401/403 auth, 404, 429 rate limit.
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(shouldRetryContentSave(0, new ApiError('nope', status, {}))).toBe(false)
    }
  })
})

describe('contentSaveRetryDelay', () => {
  it('backs off 1s, 2s, 4s, 8s over the 4 retries (attempts 0..3)', () => {
    expect(contentSaveRetryDelay(0)).toBe(1000)
    expect(contentSaveRetryDelay(1)).toBe(2000)
    expect(contentSaveRetryDelay(2)).toBe(4000)
    expect(contentSaveRetryDelay(3)).toBe(8000)
  })

  it('caps at 8s so backoff never runs away', () => {
    expect(contentSaveRetryDelay(4)).toBe(8000)
    expect(contentSaveRetryDelay(10)).toBe(8000)
  })

  it('the widened 15s backoff outlasts the old 3s budget it replaced', () => {
    const total = [0, 1, 2, 3].reduce((sum, a) => sum + contentSaveRetryDelay(a), 0)
    expect(total).toBe(15000)
  })
})

describe('suppressContentSaveToast', () => {
  it('suppresses the default red toast for a 409 publish lock (handled by refetch)', () => {
    expect(suppressContentSaveToast(lockError('locked_scheduled'))).toBe(true)
    expect(suppressContentSaveToast(lockError('locked_published'))).toBe(true)
  })

  it('does NOT suppress a bare 409 that is NOT a lock reason — that is a real conflict', () => {
    expect(suppressContentSaveToast(new ApiError('conflict', 409, {}))).toBe(false)
  })

  it('suppresses the default red toast for a transient 5xx / network blip (shown as a calm warning)', () => {
    expect(suppressContentSaveToast(new ApiError('boom', 502, {}))).toBe(true)
    expect(suppressContentSaveToast(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('does NOT suppress a real 4xx or an unexpected error — those still toast', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(suppressContentSaveToast(new ApiError('nope', status, {}))).toBe(false)
    }
  })
})
