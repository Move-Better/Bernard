import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { postFormat } from '../../src/lib/mediaEntry.js'

const ROUTE = readFileSync(fileURLToPath(new URL('../../api/_routes/producer/checkin.js', import.meta.url)), 'utf8')

const PHOTO = { url: 'https://x/p.jpg', type: 'image', kind: 'image' }
const VIDEO = { url: 'https://x/v.mp4', type: 'video', kind: 'video' }

describe('format grouping works TODAY, not in a month', () => {
  // Almost nothing carries an explicit format yet (stamping began with Phase
  // 3a), so grouping on content_items.format alone would put every historical
  // post in one meaningless bucket. The route falls back to the same derivation
  // the editor badge uses.
  it('an explicit format wins', () => {
    expect(postFormat({ platform: 'instagram', format: 'carousel', media_urls: [PHOTO, VIDEO] }).kind)
      .toBe('carousel')
  })

  it('a legacy post still lands in a meaningful bucket', () => {
    expect(postFormat({ platform: 'instagram', media_urls: [VIDEO] }).kind).toBe('reel')
    expect(postFormat({ platform: 'instagram', media_urls: [PHOTO, PHOTO] }).kind).toBe('carousel')
    expect(postFormat({ platform: 'linkedin', media_urls: [PHOTO] }).kind).toBe('post')
  })

  it('the route uses postFormat rather than a second copy of the rule', () => {
    // A private re-implementation would drift from the badge, and the owner
    // would see one format in the editor and another in the digest.
    expect(ROUTE).toContain("import { postFormat }")
    expect(ROUTE).toContain('postFormat(piece)')
  })
})

describe('a zero we could not measure is not a zero nobody saw', () => {
  it('unavailable posts are counted separately, never averaged in', () => {
    // bundle structurally cannot read IG carousels/stories and writes an
    // `unavailable` sentinel. Averaging those as 0 impressions would drag every
    // format's number down and make a measurement gap look like poor reach.
    expect(ROUTE).toContain('if (stats.unavailable) { b.unavailable++; continue }')
    expect(ROUTE).toContain('measurable')
  })

  it('per-post reach divides by MEASURABLE posts, not all posts', () => {
    expect(ROUTE).toMatch(/b\.measurable \? b\.impressions \/ b\.measurable : null/)
  })

  it('surfaces the unmeasurable count so the denominator is explainable', () => {
    expect(ROUTE).toContain('unmeasurable:')
  })
})

describe('deltas are withheld rather than invented', () => {
  it('needs a minimum sample in BOTH windows', () => {
    expect(ROUTE).toContain('MIN_POSTS_FOR_DELTA')
    expect(ROUTE).toMatch(/b\.measurable >= MIN_POSTS_FOR_DELTA/)
    expect(ROUTE).toMatch(/\(before\?\.measurable \|\| 0\) >= MIN_POSTS_FOR_DELTA/)
  })

  it('refuses to divide by a zero base', () => {
    // "+∞%" from a base of zero is noise dressed as a finding.
    expect(ROUTE).toMatch(/\(before\?\.impressions \|\| 0\) > 0/)
  })

  it('an incomparable format reports null, not 0', () => {
    // 0% reads as "flat" — a real finding. null renders as "not enough yet".
    expect(ROUTE).toContain('deltaPct: comparable')
    expect(ROUTE).toMatch(/:\s*null,/)
  })

  it('compares like-for-like windows', () => {
    expect(ROUTE).toContain('2 * WINDOW_DAYS')
  })
})

describe('the taste half shows current work', () => {
  it('samples newest-first, not a flattering historical pick', () => {
    expect(ROUTE).toContain('order=published_at.desc')
    expect(ROUTE).toMatch(/current\.slice\(0, SAMPLE_COUNT\)/)
  })
})

describe('tenant scoping', () => {
  it('every query is workspace-scoped', () => {
    const qs = ROUTE.match(/(content_items|engagement_snapshots)\?[^`]*/g) || []
    expect(qs.length).toBeGreaterThan(1)
    for (const q of qs) expect(q).toContain('workspace_id=eq.')
  })
})
