import { describe, it, expect, vi, beforeEach } from 'vitest'

// Drives the real cron handler with bundle and the email stubbed, so the test
// proves the stale-stats check is WIRED into the sweep, not just that the pure
// predicate works.
const accounts = vi.fn()
const snapshots = vi.fn()
const notify = vi.fn(async () => ({ ok: true }))

vi.mock('../../api/_lib/social/bundlePublisher.js', async (orig) => {
  const real = await orig()
  return {
    ...real,
    BundlePublisher: class {
      listAccounts() { return accounts() }
      getAccountSnapshots(args) { return snapshots(args) }
    },
  }
})
vi.mock('../../api/_lib/notifyChannelHealth.js', () => ({ notifyChannelHealth: (a) => notify(a) }))

process.env.SUPABASE_URL = 'https://sb.test'
process.env.SUPABASE_SERVICE_KEY = 'svc'
process.env.BUNDLE_API_KEY = 'bk'
process.env.CRON_SECRET = 'cs'

const WS = { id: 'ws1', slug: 'movebetter', bundle_team_id: 'team1' }
globalThis.fetch = vi.fn(async (url) => ({
  ok: true,
  json: async () => (String(url).includes('/workspaces?') ? [WS] : []),
}))

const { default: handler } = await import('../../api/_routes/cron/check-channel-health.js')

function run() {
  const res = { code: 0, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  return handler({ headers: { authorization: 'Bearer cs' } }, res).then(() => res)
}

const FB = { type: 'FACEBOOK', displayName: 'Move Better', connected: true, reason: null, connectedAt: '2026-07-22T03:48:38.701Z' }

beforeEach(() => { notify.mockClear(); snapshots.mockReset() })

describe('check-channel-health cron — stale stats', () => {
  it('alerts on a connected account whose stats stopped', async () => {
    accounts.mockReturnValue([FB])
    snapshots.mockResolvedValue({ snapshots: [{ at: '2026-10-21T11:05:00.000Z' }] })
    const res = await run()
    expect(res.body.unhealthy).toBe(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0].unhealthy).toEqual([
      { type: 'FACEBOOK', displayName: 'Move Better', reason: 'no stats received since 2026-10-21', stale: true },
    ])
  })

  it('stays quiet when stats are fresh', async () => {
    accounts.mockReturnValue([FB])
    snapshots.mockResolvedValue({ snapshots: [{ at: new Date(Date.now() - 3_600_000).toISOString() }] })
    const res = await run()
    expect(res.body.healthy).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('a stats read that errors is not treated as a dead channel', async () => {
    accounts.mockReturnValue([FB])
    snapshots.mockRejectedValue(new Error('bundle 500'))
    const res = await run()
    expect(res.body.healthy).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })
})
