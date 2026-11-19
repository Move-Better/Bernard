import { describe, it, expect } from 'vitest'
import { inviteAuthMode } from '../../src/lib/inviteTicket.js'

describe('inviteAuthMode', () => {
  it('shows sign-up for a new invitee', () => {
    expect(inviteAuthMode('?__clerk_ticket=abc&__clerk_status=sign_up')).toBe('signup')
  })
  it('shows sign-in for an invitee who already has an account', () => {
    expect(inviteAuthMode('?__clerk_ticket=abc&__clerk_status=sign_in')).toBe('signin')
  })
  it('shows sign-in with no ticket, even if a status is present', () => {
    expect(inviteAuthMode('')).toBe('signin')
    expect(inviteAuthMode('?__clerk_status=sign_up')).toBe('signin')
  })
})
