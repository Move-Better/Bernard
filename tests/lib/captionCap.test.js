import { describe, it, expect } from 'vitest'
import {
  checkCaptionCap,
  platformCap,
  clampToCap,
  AUTO_CLAMP_PLATFORMS as SERVER_AUTO_CLAMP,
} from '../../api/_lib/socialLengthTargets.js'
import {
  captionOverage,
  CAPTION_LIMITS,
  AUTO_CLAMP_PLATFORMS as CLIENT_AUTO_CLAMP,
} from '../../src/lib/contentMeta.js'

const chars = (n) => 'x'.repeat(n)

describe('checkCaptionCap — block at approve, not at publish', () => {
  it('passes an Instagram caption at exactly the cap', () => {
    const r = checkCaptionCap('instagram', chars(2200))
    expect(r).toEqual({ ok: true, cap: 2200, length: 2200, over: 0 })
  })

  it('blocks one character over, and reports how much has to go', () => {
    const r = checkCaptionCap('instagram', chars(2250))
    expect(r.ok).toBe(false)
    expect(r.cap).toBe(2200)
    expect(r.over).toBe(50)
  })

  it('never blocks GBP — it clamps sentence-aware at publish instead', () => {
    const r = checkCaptionCap('gbp', chars(3000))
    expect(r.ok).toBe(true)
    // …and the clamp it relies on still fits inside the cap.
    expect(clampToCap(chars(3000), platformCap('gbp')).length).toBeLessThanOrEqual(1500)
  })

  it('never blocks a platform with no known hard ceiling', () => {
    // Guessing a limit we do not actually know would block real captions.
    expect(platformCap('facebook')).toBe(null)
    expect(checkCaptionCap('facebook', chars(100_000)).ok).toBe(true)
    expect(checkCaptionCap('not_a_platform', chars(100_000)).ok).toBe(true)
  })

  it('treats a missing/non-string body as length 0 rather than throwing', () => {
    expect(checkCaptionCap('instagram', null).ok).toBe(true)
    expect(checkCaptionCap('instagram', undefined).length).toBe(0)
  })

  it('blocks the terse platforms at their real limits', () => {
    expect(checkCaptionCap('twitter', chars(281)).ok).toBe(false)
    expect(checkCaptionCap('twitter', chars(280)).ok).toBe(true)
    expect(checkCaptionCap('bluesky', chars(301)).ok).toBe(false)
  })
})

describe('captionOverage — the client mirror', () => {
  it('agrees with the server on the Instagram case', () => {
    expect(captionOverage('instagram', chars(2250))).toBe(50)
    expect(captionOverage('instagram', chars(2200))).toBe(0)
  })

  it('reports no overage for GBP, matching the server exemption', () => {
    expect(captionOverage('gbp', chars(3000))).toBe(0)
  })

  it('reports no overage for an uncapped platform or a non-string body', () => {
    expect(captionOverage('facebook', chars(100_000))).toBe(0)
    expect(captionOverage('instagram', null)).toBe(0)
  })
})

// The drift guard. Two tables describe caption ceilings — CAPTION_LIMITS drives
// the editor warning and the disabled Approve button, SOCIAL_LENGTH drives the
// server gate. If they disagree, the button says one thing and the route does
// another, which is worse than either being wrong on its own.
describe('client and server caption ceilings stay in step', () => {
  const PLATFORMS = [...new Set([
    ...Object.keys(CAPTION_LIMITS),
    'facebook', 'linkedin', 'twitter', 'threads', 'bluesky', 'mastodon', 'gbp', 'instagram',
  ])]

  it('never lets the client be MORE permissive than the server', () => {
    for (const p of PLATFORMS) {
      const server = platformCap(p)
      const client = CAPTION_LIMITS[p]
      if (server == null) continue
      // A server-capped platform missing from the client table would mean the
      // author gets no warning and Approve fails on click with no explanation.
      expect(client, `${p} is capped server-side but missing from CAPTION_LIMITS`).toBeDefined()
      expect(client, `${p}: client cap ${client} exceeds server cap ${server}`).toBeLessThanOrEqual(server)
    }
  })

  it('keeps the auto-clamp exemption identical on both sides', () => {
    expect([...CLIENT_AUTO_CLAMP].sort()).toEqual([...SERVER_AUTO_CLAMP].sort())
  })

  it('agrees on every platform both tables cap', () => {
    for (const p of PLATFORMS) {
      const server = platformCap(p)
      const client = CAPTION_LIMITS[p]
      if (server == null || client == null) continue
      expect(client, `${p} cap disagrees`).toBe(server)
    }
  })
})
