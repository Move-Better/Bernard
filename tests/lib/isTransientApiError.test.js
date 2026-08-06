import { describe, it, expect } from 'vitest'
import { ApiError, isTransientApiError } from '../../src/lib/apiError.js'

// Guards the retry predicate wired into useUpdateContentItem (queries.js): a
// content save auto-retries ONLY transient failures. Getting this backwards is
// harmful in both directions —
//   - retry a 409 publish lock / 400 validation → wasted round-trips, and for a
//     non-idempotent action, a double-write;
//   - don't retry a 5xx / network blip → the exact "repeated Update failed"
//     dead-end this change exists to fix (movebetter, 2026-08-05).
describe('isTransientApiError', () => {
  it('retries transient server failures (5xx)', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isTransientApiError(new ApiError('boom', status, {}))).toBe(true)
    }
  })

  it('retries a network error with no HTTP status', () => {
    // fetch() rejects with a plain TypeError before any Response — no .status.
    expect(isTransientApiError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isTransientApiError(new Error('network down'))).toBe(true)
  })

  it('does NOT retry a deliberate 4xx rejection', () => {
    // 409 = publish lock, 400 = validation, 401/403 = auth, 404, 429 = rate limit.
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(isTransientApiError(new ApiError('nope', status, {}))).toBe(false)
    }
  })

  it('treats a plain object carrying a numeric status like an ApiError', () => {
    expect(isTransientApiError({ status: 503 })).toBe(true)
    expect(isTransientApiError({ status: 409 })).toBe(false)
  })
})
