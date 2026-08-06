import { describe, it, expect } from 'vitest'
import { fixBrokenHashtags } from '../../api/_lib/fixBrokenHashtags.js'

describe('fixBrokenHashtags — rejoin a hashtag split by a stray space', () => {
  it('fixes the reported live case (#MovementIsM edicine)', () => {
    const caption =
      'Move better today.\n\n#MoveBetter #MovementIsM edicine #PhysicalTherapy #ExerciseMotivation #BuildingStrength'
    expect(fixBrokenHashtags(caption)).toBe(
      'Move better today.\n\n#MoveBetter #MovementIsMedicine #PhysicalTherapy #ExerciseMotivation #BuildingStrength',
    )
  })

  it('rejoins a split at the end of the hashtag line', () => {
    expect(fixBrokenHashtags('#MoveBetter #PhysicalThera py'))
      .toBe('#MoveBetter #PhysicalTherapy')
  })

  it('rejoins two independent splits on one line', () => {
    expect(fixBrokenHashtags('#Move Better #MovementIsM edicine #PT'))
      .toBe('#MoveBetter #MovementIsMedicine #PT')
  })

  it('leaves a clean hashtag line untouched', () => {
    const line = '#MoveBetter #MovementIsMedicine #PhysicalTherapy'
    expect(fixBrokenHashtags(line)).toBe(line)
  })

  it('does NOT merge a normal lowercase final tag into the previous tag', () => {
    // "#MovementIsMedicine #physicaltherapy" — the second token starts with '#',
    // so it is a real tag, never a split-off continuation.
    const line = '#MoveBetter #MovementIsMedicine #physicaltherapy'
    expect(fixBrokenHashtags(line)).toBe(line)
  })

  it('does NOT touch prose that merely mentions a hashtag (not a cluster)', () => {
    const prose = 'Follow #MoveBetter online for more from our team.'
    expect(fixBrokenHashtags(prose)).toBe(prose)
  })

  it('does NOT rejoin across a real word between two prose mentions', () => {
    // Below the 60% hashtag-token threshold → not treated as a cluster.
    const prose = 'Book at #MoveBetter today and tag #PhysicalTherapy friends.'
    expect(fixBrokenHashtags(prose)).toBe(prose)
  })

  it('is idempotent', () => {
    const once = fixBrokenHashtags('#MoveBetter #MovementIsM edicine #PhysicalTherapy')
    expect(fixBrokenHashtags(once)).toBe(once)
  })

  it('passes non-strings and empty strings through unchanged', () => {
    expect(fixBrokenHashtags('')).toBe('')
    expect(fixBrokenHashtags(null)).toBe(null)
    expect(fixBrokenHashtags(undefined)).toBe(undefined)
  })
})
