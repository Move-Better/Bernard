// recordDispatchState must report a rejected save, not only a thrown fetch: a
// PATCH that came back non-2xx used to pass silently, so the record of which
// GBP locations had posted was lost and the next retry re-posted them
// (audit 2026-11-18, P2).
import { describe, it, expect, vi, afterEach } from 'vitest'

process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_KEY = 'test-only-invalid'
const { recordDispatchState } = await import('../../api/_lib/dispatchClaim.js')

afterEach(() => vi.unstubAllGlobals())

describe('recordDispatchState', () => {
  it('returns false when PostgREST rejects the write', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await recordDispatchState('id', 'ws', {})).toBe(false)
  })

  it('returns false when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await recordDispatchState('id', 'ws', {})).toBe(false)
  })

  it('returns true when the write lands, and sends the state', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', f)
    expect(await recordDispatchState('id', 'ws', { published_channels: { gbp: {} } })).toBe(true)
    expect(JSON.parse(f.mock.calls[0][1].body).dispatch_state).toEqual({ published_channels: { gbp: {} } })
  })
})
