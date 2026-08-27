import { describe, it, expect } from 'vitest'
import { getInitials } from '../../src/lib/utils.js'

describe('getInitials — the shared avatar-initials util', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getInitials('Michael Quasney')).toBe('MQ')
    expect(getInitials('philip')).toBe('P')
    expect(getInitials('a b c d')).toBe('AB')
  })

  // The /overview crash: a recap row can have an unassigned staff member, so
  // getInitials(null) was called and .split() threw "Cannot read properties of
  // null (reading 'split')", which the page error boundary swallowed into a
  // whole blank page. A null/undefined/empty name must return '' (the avatar
  // renders empty; adjacent text already shows the 'Team' fallback), never throw.
  it('returns an empty string for null / undefined / empty, never throwing', () => {
    expect(getInitials(null)).toBe('')
    expect(getInitials(undefined)).toBe('')
    expect(getInitials('')).toBe('')
    expect(getInitials('   ')).toBe('')
  })
})
