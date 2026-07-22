import { describe, it, expect } from 'vitest'
import { accountIsConnected } from '../../api/_lib/social/bundlePublisher.js'
import { channelLabel } from '../../api/_lib/notifyChannelHealth.js'

describe('accountIsConnected — what counts as a dead channel', () => {
  it('flags the states that mean a token needs re-authorizing', () => {
    for (const status of [
      'DISCONNECTED', 'disconnected', 'TOKEN_EXPIRED', 'expired',
      'ERROR', 'REVOKED', 'INVALID_TOKEN', 'UNAUTHORIZED', 'NEEDS_REAUTH',
    ]) {
      expect(accountIsConnected({ status }), `${status} should read as broken`).toBe(false)
    }
  })

  it('leaves a healthy account alone', () => {
    expect(accountIsConnected({ status: 'ACTIVE' })).toBe(true)
    expect(accountIsConnected({ status: 'connected' })).toBe(true)
  })

  // This is the deliberate bias, not an oversight. The value drives an email
  // alert, and a false "your Facebook is disconnected" trains people to ignore
  // the alert — the exact failure the check exists to fix. Missing an unusual
  // status string is the cheaper mistake.
  it('treats an unknown, empty or absent status as healthy rather than crying wolf', () => {
    expect(accountIsConnected({ status: 'SOME_FUTURE_STATE' })).toBe(true)
    expect(accountIsConnected({ status: '' })).toBe(true)
    expect(accountIsConnected({ status: '   ' })).toBe(true)
    expect(accountIsConnected({ status: null })).toBe(true)
    expect(accountIsConnected({})).toBe(true)
    expect(accountIsConnected(null)).toBe(true)
    // A non-string (bad payload) must not throw or read as broken.
    expect(accountIsConnected({ status: 42 })).toBe(true)
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
