import { describe, it, expect } from 'vitest'
import { SEED_SLUGS } from '../../api/_lib/onboardingValidation.js'

// The founding-spots counter (onboarding/capacity.js, onboarding/claim.js)
// counts every workspace whose slug is NOT in SEED_SLUGS as an external clinic.
// The list still held 'movebetter-people' after that workspace was renamed
// 'movebetter', so Move Better itself used up one of the 10 founding spots.
describe('SEED_SLUGS', () => {
  it("excludes the live Move Better workspace, not the retired slug", () => {
    expect(SEED_SLUGS.has('movebetter')).toBe(true)
    expect(SEED_SLUGS.has('movebetter-people')).toBe(false)
  })

  it('still excludes Equine and Animals', () => {
    expect(SEED_SLUGS.has('movebetter-equine')).toBe(true)
    expect(SEED_SLUGS.has('movebetter-animals')).toBe(true)
  })
})

describe('in-house workspaces', () => {
  it("counts Q's personal workspace and the studio as Move Better's own (Q, 2026-11-12)", () => {
    expect(SEED_SLUGS.has('qbook')).toBe(true)
    expect(SEED_SLUGS.has('studio')).toBe(true)
  })

  it('still counts outside clinics against the cap', () => {
    expect(SEED_SLUGS.has('groovechiro')).toBe(false)
    expect(SEED_SLUGS.has('tnw')).toBe(false)
  })
})
