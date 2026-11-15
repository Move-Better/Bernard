import { describe, it, expect } from 'vitest'
import { statsStaleReason, snapshotMinute, mapAccountSnapshotItem } from '../../api/_lib/social/bundlePublisher.js'
import { channelHealthCopy } from '../../api/_lib/notifyChannelHealth.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-15T14:00:00.000Z')

describe('statsStaleReason — a "connected" channel whose stats stopped', () => {
  it('is quiet while bundle keeps delivering daily stats', () => {
    expect(statsStaleReason({ newestAt: new Date(NOW - 1 * DAY).toISOString(), connectedAt: '2026-07-22T03:48:38.701Z', now: NOW })).toBe(null)
  })

  it('is quiet right at the 3-day line, alarms just past it', () => {
    expect(statsStaleReason({ newestAt: new Date(NOW - 3 * DAY).toISOString(), now: NOW })).toBe(null)
    expect(statsStaleReason({ newestAt: new Date(NOW - 3 * DAY - 60_000).toISOString(), now: NOW })).toMatch(/no stats received since/)
  })

  it('names the date stats stopped (Move Better Facebook, live 2026-11-15)', () => {
    expect(statsStaleReason({ newestAt: '2026-10-21T11:05:51.669Z', connectedAt: '2026-07-22T03:48:38.701Z', now: NOW }))
      .toBe('no stats received since 2026-10-21')
  })

  it('keeps alarming once bundle\'s 31-day window has emptied out', () => {
    expect(statsStaleReason({ newestAt: null, connectedAt: '2026-07-22T03:48:38.701Z', now: NOW }))
      .toBe('no stats received in the last 30 days')
  })

  it('does not alarm on a just-connected account that has no stats yet', () => {
    expect(statsStaleReason({ newestAt: null, connectedAt: new Date(NOW - 1 * DAY).toISOString(), now: NOW })).toBe(null)
    expect(statsStaleReason({ newestAt: null, connectedAt: null, now: NOW })).toBe(null)
  })
})

describe('snapshotMinute — one key per bundle daily item', () => {
  it('lands two reads of the same item, ms apart, on the same instant (live: …51.662 vs …51.669)', () => {
    expect(snapshotMinute('2026-10-21T11:05:51.662Z')).toBe('2026-10-21T11:05:00.000Z')
    expect(snapshotMinute('2026-10-21T11:05:51.669Z')).toBe('2026-10-21T11:05:00.000Z')
  })

  it('keeps consecutive daily items distinct', () => {
    expect(snapshotMinute('2026-10-20T10:35:51.000Z')).not.toBe(snapshotMinute('2026-10-21T11:05:51.000Z'))
  })

  it('returns null for missing or unparseable input', () => {
    expect(snapshotMinute(null)).toBe(null)
    expect(snapshotMinute('not a date')).toBe(null)
  })

  it('is what mapAccountSnapshotItem stores as `at`', () => {
    expect(mapAccountSnapshotItem({ createdAt: '2026-10-21T11:05:51.669Z' }).at).toBe('2026-10-21T11:05:00.000Z')
  })
})

describe('channelHealthCopy — honest wording for each failure', () => {
  const stale = { type: 'FACEBOOK', reason: 'no stats received since 2026-10-21', stale: true }
  const dead = { type: 'INSTAGRAM', reason: 'disconnected' }

  it('a stale-only alert does not claim publishing is broken', () => {
    const c = channelHealthCopy({ unhealthy: [stale], wsName: 'Move Better' })
    expect(c.kind).toBe('channel_stale')
    expect(c.subject).toBe('⚠️ Facebook stopped responding — Move Better')
    expect(c.lead).not.toMatch(/can't post|will fail|disconnected/i)
    expect(c.lead).toMatch(/still listed as connected/)
  })

  it('any truly disconnected channel keeps the hard wording', () => {
    const c = channelHealthCopy({ unhealthy: [stale, dead], wsName: 'Move Better' })
    expect(c.kind).toBe('channel_disconnected')
    expect(c.subject).toMatch(/disconnected/)
    expect(c.lead).toMatch(/will fail/)
  })
})
