import { describe, it, expect } from 'vitest'
import { accountIsConnected, disconnectReason } from '../../api/_lib/social/bundlePublisher.js'
import { channelLabel } from '../../api/_lib/notifyChannelHealth.js'

// Fixtures shaped like the REAL socialAccount object — verified 2026-07-22
// against the installed SDK's TeamGetTeamResponse type and a live teamGetTeam
// call against the Move Better team. There is no `status` field; a prior
// version of this file tested one anyway, against invented strings that never
// occur, and the tests passed while the feature it covered could never fire.
const HEALTHY = { deletedAt: null, disconnectedCheckTryAt: null, deleteOn: null }

describe('accountIsConnected — what bundle itself believes about a connection', () => {
  it('is healthy when none of the three signals are set (the real shape of every live account)', () => {
    expect(accountIsConnected(HEALTHY)).toBe(true)
  })

  it('is broken once bundle has soft-deleted the connection', () => {
    expect(accountIsConnected({ ...HEALTHY, deletedAt: '2026-07-01T00:00:00.000Z' })).toBe(false)
  })

  it('is broken while bundle\'s own disconnect-check is actively retrying it', () => {
    expect(accountIsConnected({ ...HEALTHY, disconnectedCheckTryAt: '2026-07-20T00:00:00.000Z' })).toBe(false)
  })

  it('is broken once scheduled for automatic removal', () => {
    expect(accountIsConnected({ ...HEALTHY, deleteOn: '2026-08-01T00:00:00.000Z' })).toBe(false)
  })

  it('treats an absent or malformed account as healthy rather than throwing', () => {
    expect(accountIsConnected(null)).toBe(true)
    expect(accountIsConnected(undefined)).toBe(true)
    expect(accountIsConnected({})).toBe(true)
  })
})

describe('disconnectReason — the WHY, shown in the email and the cron log', () => {
  it('is null for a connected account', () => {
    expect(disconnectReason(HEALTHY)).toBe(null)
  })

  it('names a hard delete plainly', () => {
    expect(disconnectReason({ ...HEALTHY, deletedAt: '2026-07-01' })).toBe('disconnected')
  })

  it('names the removal date when scheduled for deletion', () => {
    const r = disconnectReason({ ...HEALTHY, deleteOn: '2026-08-15T00:00:00.000Z' })
    expect(r).toContain('removed')
    expect(r).toMatch(/\d/) // carries an actual date, not just the word "soon"
  })

  it('falls back to a plain reconnect prompt when only the disconnect-check has fired', () => {
    expect(disconnectReason({ ...HEALTHY, disconnectedCheckTryAt: '2026-07-20' })).toBe('reconnect needed')
  })

  it('prefers the hard delete reason over a scheduled-removal date when both are set', () => {
    const r = disconnectReason({ ...HEALTHY, deletedAt: '2026-07-01', deleteOn: '2026-08-01' })
    expect(r).toBe('disconnected')
  })
})

describe('channelLabel — names a clinic would recognise', () => {
  it('maps bundle account types to human names', () => {
    expect(channelLabel({ type: 'FACEBOOK' })).toBe('Facebook')
    expect(channelLabel({ type: 'GOOGLE_BUSINESS' })).toBe('Google Business Profile')
    expect(channelLabel({ type: 'TWITTER' })).toBe('X')
  })

  it('falls back to the raw type rather than rendering "undefined"', () => {
    expect(channelLabel({ type: 'SOMETHING_NEW' })).toBe('SOMETHING_NEW')
    expect(channelLabel({})).toBe('A channel')
    expect(channelLabel(null)).toBe('A channel')
  })
})
