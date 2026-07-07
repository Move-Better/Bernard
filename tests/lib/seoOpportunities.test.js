import { describe, it, expect } from 'vitest'
import {
  classifyDecay,
  classifyCannibalization,
  matchPublishedQuery,
} from '../../api/_lib/seoOpportunities.js'

describe('classifyDecay', () => {
  // Modeled on real Move Better snapshots (Jun 29 → Jul 6).
  const prior = [
    { query: 'belly breathing vs chest breathing', position: 11.5, impressions: 27 },
    { query: 'animal chiropractor near me',         position: 11.6, impressions: 16 },
    { query: 'body tempering near me',              position: 13.5, impressions: 13 },
    { query: 'animal chiropractic portland',        position: 10.4, impressions: 7 },  // < impr floor
    { query: 'balance doctor near me',              position: 1.0,  impressions: 1 },  // jitter, < floor
    { query: 'move better',                         position: 6.4,  impressions: 224 }, // stable, no drop
  ]
  const current = [
    { query: 'belly breathing vs chest breathing', position: 17.3, impressions: 3 },
    { query: 'animal chiropractor near me',         position: 20.1, impressions: 8 },
    { query: 'body tempering near me',              position: 18.8, impressions: 9 },
    { query: 'animal chiropractic portland',        position: 33.0, impressions: 4 },
    { query: 'balance doctor near me',              position: 6.0,  impressions: 2 },
    { query: 'move better',                         position: 6.7,  impressions: 219 },
  ]

  it('flags the three real slippers and nothing else (calibrated floors)', () => {
    const out = classifyDecay(current, prior)
    const queries = out.map((d) => d.query)
    expect(queries).toEqual([
      // biggest drop first
      'animal chiropractor near me',        // 11.6 → 20.1, drop 8.5
      'belly breathing vs chest breathing', // 11.5 → 17.3, drop 5.8
      'body tempering near me',             // 13.5 → 18.8, drop 5.3
    ])
    // low-impression crash + jitter + stable branded term all excluded
    expect(queries).not.toContain('animal chiropractic portland') // 7 impr < 10 floor
    expect(queries).not.toContain('balance doctor near me')       // 1 impr < 10 floor
    expect(queries).not.toContain('move better')                  // no drop
  })

  it('reports before/after position, drop and prior-week impressions', () => {
    const [top] = classifyDecay(current, prior)
    expect(top).toMatchObject({
      query: 'animal chiropractor near me',
      prevPosition: 11.6,
      position: 20.1,
      drop: 8.5,
      impressions: 16,
    })
    expect(top.why).toContain('#11.6')
    expect(top.intent).toBeTruthy()
  })

  it('honors dismissed queries and requires presence in both weeks', () => {
    const out = classifyDecay(current, prior, { dismissed: new Set(['animal chiropractor near me']) })
    expect(out.map((d) => d.query)).not.toContain('animal chiropractor near me')
    // a query only in the current week (no prior) is never judged
    const onlyCurrent = classifyDecay([{ query: 'new term', position: 30, impressions: 50 }], [])
    expect(onlyCurrent).toEqual([])
  })
})

describe('classifyCannibalization', () => {
  it('flags a query with 2+ own pages ranking, listing them best-first', () => {
    const rows = [
      { query: 'low back pain', page: 'https://x.co/a', position: 6,  impressions: 40, clicks: 3 },
      { query: 'low back pain', page: 'https://x.co/b', position: 12, impressions: 22, clicks: 1 },
      { query: 'sciatica',      page: 'https://x.co/c', position: 8,  impressions: 30, clicks: 2 }, // single page
    ]
    const out = classifyCannibalization(rows)
    expect(out).toHaveLength(1)
    expect(out[0].query).toBe('low back pain')
    expect(out[0].pages.map((p) => p.position)).toEqual([6, 12]) // best-ranked first
  })

  it('ignores weak pages (deep position / tiny impressions) and single-page queries', () => {
    const rows = [
      { query: 'q', page: 'p1', position: 5,  impressions: 40 },
      { query: 'q', page: 'p2', position: 55, impressions: 40 }, // too deep
      { query: 'r', page: 'p3', position: 4,  impressions: 2 },  // too few impressions
      { query: 'r', page: 'p4', position: 6,  impressions: 40 },
    ]
    const out = classifyCannibalization(rows)
    expect(out).toEqual([]) // q collapses to one qualifying page; r likewise
  })
})

describe('matchPublishedQuery', () => {
  it('exact on normalized equality, likely on shared significant word, false otherwise', () => {
    expect(matchPublishedQuery('Sciatica', 'sciatica')).toBe('exact')
    expect(matchPublishedQuery('  Low   Back Pain ', 'low back pain')).toBe('exact')
    expect(matchPublishedQuery('Sciatica', 'sciatica exercises portland')).toBe('likely')
    expect(matchPublishedQuery('Plantar fasciitis', 'best chiropractor near me')).toBe(false)
    expect(matchPublishedQuery('', 'anything')).toBe(false)
  })
})
