import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unitFormats } from '../../api/_lib/cadenceSlots.js'
import { ATOM_FORMATS } from '../../api/_lib/atomPlan.js'
import { FORMAT_IDS } from '../../src/lib/platformFormats.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const count = (arr, v) => arr.filter((x) => x === v).length

describe('unitFormats — carousel joins the mix without disturbing it', () => {
  it('DEFAULTS to the existing behaviour exactly (carousel opt-in)', () => {
    // The single most important assertion here: every workspace that never asks
    // for carousels must get a byte-identical slot mix. 4 IG posts = 1 post + 3
    // reels, the ratio Q set on 2026-07-21.
    const before = unitFormats('instagram', 4)
    expect(before).toEqual(['post', 'reel', 'reel', 'reel'])
    expect(unitFormats('instagram', 4, {})).toEqual(before)
    expect(unitFormats('instagram', 4, { carouselTarget: 0 })).toEqual(before)
  })

  it('carves carousels from the POST share, never the reel share', () => {
    // Reels are the supply-constrained format — each needs a real rendered
    // clip. Trading them for carousels would under-fill the lane the reel
    // worker is actively trying to satisfy.
    const mix = unitFormats('instagram', 4, { carouselTarget: 1 })
    expect(count(mix, 'reel')).toBe(count(unitFormats('instagram', 4), 'reel'))
    expect(count(mix, 'carousel')).toBe(1)
    expect(count(mix, 'post')).toBe(0)
    expect(mix).toHaveLength(4)
  })

  it('clamps a carousel target that would eat into reels', () => {
    // Asking for 4 carousels in a 4-post week where 3 are reels can only yield
    // 1 — silently, rather than erroring or stealing a reel slot.
    const mix = unitFormats('instagram', 4, { carouselTarget: 99 })
    expect(count(mix, 'reel')).toBe(3)
    expect(count(mix, 'carousel')).toBe(1)
    expect(mix).toHaveLength(4)
  })

  it('never changes the total number of slots', () => {
    for (const target of [0, 1, 3, 5, 7, 12]) {
      for (const carouselTarget of [0, 1, 2, 50]) {
        expect(unitFormats('instagram', target, { carouselTarget })).toHaveLength(target)
      }
    }
  })

  it('ignores carousel on platforms with no carousel lane', () => {
    expect(unitFormats('linkedin', 3, { carouselTarget: 3 })).toEqual(['post', 'post', 'post'])
    expect(unitFormats('instagram_story', 2, { carouselTarget: 2 })).toEqual(['story', 'story'])
  })

  it('tolerates garbage targets rather than emitting NaN slots', () => {
    expect(unitFormats('instagram', 4, { carouselTarget: -3 })).toEqual(unitFormats('instagram', 4))
    expect(unitFormats('instagram', 4, { carouselTarget: 'x' })).toEqual(unitFormats('instagram', 4))
    expect(unitFormats('instagram', 4, { carouselTarget: 1.9 })).toEqual(
      unitFormats('instagram', 4, { carouselTarget: 1 }))
  })
})

describe('carousel is accepted everywhere a format is whitelisted', () => {
  // Both of these SILENTLY coerce an unknown format to 'post' rather than
  // erroring — and sanitizeChannelSlots rewrites persisted slots on EVERY
  // settings save. So a carousel slot saved while a whitelist was stale is not
  // rejected, it is quietly downgraded on some later unrelated save.
  it('workspace/me.js slot + cadence-format whitelists include carousel', () => {
    const src = read('../../api/_routes/workspace/me.js')
    expect(src).toMatch(/SLOT_FORMATS = new Set\(\[[^\]]*'carousel'/)
    expect(src).toMatch(/CADENCE_FORMATS = new Set\(\[[^\]]*'carousel'/)
  })

  it('create-slot-atom.js whitelist includes carousel', () => {
    expect(read('../../api/_routes/content-plan/create-slot-atom.js'))
      .toMatch(/SLOT_FORMATS = new Set\(\[[^\]]*'carousel'/)
  })

  it('the atom vocabulary and the content_items vocabulary agree', () => {
    expect(Object.values(ATOM_FORMATS)).toContain('carousel')
    for (const v of Object.values(ATOM_FORMATS)) expect(FORMAT_IDS).toContain(v)
  })
})

describe('every mergeSlotsIntoCadence caller passes the format targets', () => {
  // A partial thread is the real failure mode: the planner would build a mix the
  // calendar never shows (or vice versa) — the client/server mirror-pair class.
  const CALLERS = [
    'api/_routes/moments/summary.js',
    'api/_routes/content-plan/week-summary.js',
    'api/_routes/content-plan/month-summary.js',
    'api/_lib/reelFactory.js',
    'api/_lib/strategistPlan.js',
  ]

  it('finds every caller (a moved call would pass vacuously)', () => {
    for (const f of CALLERS) {
      expect(read(`../../${f}`), f).toContain('mergeSlotsIntoCadence(')
    }
  })

  it('none calls it with only three arguments', () => {
    for (const f of CALLERS) {
      const src = read(`../../${f}`)
      const call = src.match(/mergeSlotsIntoCadence\([^)]*\)/)?.[0] || ''
      expect(call, `${f} drops the format targets`).toMatch(/formats/)
    }
  })
})
