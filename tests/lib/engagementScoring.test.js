import { describe, it, expect } from 'vitest'
import { scoreSnapshot, rankTopPerformers } from '../../api/_lib/engagementScoring.js'

const published = (topic, platform) => ({ topic, platform, status: 'published' })

describe('scoreSnapshot', () => {
  it('scores ga4 on pageviews', () => {
    expect(scoreSnapshot({ source: 'ga4', stats: { pageviews: 8 } }))
      .toEqual({ score: 8, pageviews: 8, reach: 0, engagement: 0 })
  })

  it('scores bundle on impressionsUnique, with likes+comments+shares+saves as engagement', () => {
    const r = scoreSnapshot({
      source: 'bundle',
      stats: { statistics: { impressionsUnique: 145, likes: 12, comments: 2, shares: 1, saves: 3 } },
    })
    expect(r.score).toBe(145)
    expect(r.reach).toBe(145)
    expect(r.engagement).toBe(18)
  })

  it('scores gbp on views + actions rather than falling through to the Buffer shape', () => {
    // Regression: gbp has no `statistics` object, so before the dedicated
    // branch it hit `stats.statistics.reach ?? 0` and scored 0 forever.
    const r = scoreSnapshot({ source: 'gbp', stats: { views: 40, actions: 3, service: 'gbp' } })
    expect(r.score).toBe(43)
    expect(r.reach).toBe(40)
    expect(r.engagement).toBe(3)
  })

  it('scores buffer 0 — the API returns no engagement data', () => {
    expect(scoreSnapshot({ source: 'buffer', stats: { statistics: {} } }).score).toBe(0)
  })
})

describe('rankTopPerformers', () => {
  it('ranks by performance relative to the platform average, not raw magnitude', () => {
    // Instagram reach runs an order of magnitude above LinkedIn's, so a raw
    // sort buries every LinkedIn post. The LinkedIn row here is 4x its own
    // platform average; the bigger-in-absolute-terms Instagram row is ~1.3x.
    const rows = [
      { content_item_id: 'li-hit',  source: 'bundle', stats: { statistics: { impressionsUnique: 37 } }, content_items: published('Sciatica', 'linkedin') },
      { content_item_id: 'li-a',    source: 'bundle', stats: { statistics: { impressionsUnique: 5 } },  content_items: published('A', 'linkedin') },
      { content_item_id: 'li-b',    source: 'bundle', stats: { statistics: { impressionsUnique: 5 } },  content_items: published('B', 'linkedin') },
      { content_item_id: 'ig-big',  source: 'bundle', stats: { statistics: { impressionsUnique: 145 } }, content_items: published('Bicep', 'instagram') },
      { content_item_id: 'ig-c',    source: 'bundle', stats: { statistics: { impressionsUnique: 70 } },  content_items: published('C', 'instagram') },
    ]
    const top = rankTopPerformers(rows, 5)
    expect(top[0].topic).toBe('Sciatica')
    expect(top[0].platform).toBe('linkedin')
    expect(top[0].score).toBe(37)          // raw score preserved for display
    expect(top[0].relScore).toBeCloseTo(37 / ((37 + 5 + 5) / 3), 2)
  })

  it('surfaces more than one platform when a raw sort would return only the loudest', () => {
    const rows = [
      { content_item_id: 'b1', source: 'ga4', stats: { pageviews: 8 }, content_items: published('Blog 1', 'blog') },
      { content_item_id: 'b2', source: 'ga4', stats: { pageviews: 6 }, content_items: published('Blog 2', 'blog') },
      { content_item_id: 'b3', source: 'ga4', stats: { pageviews: 4 }, content_items: published('Blog 3', 'blog') },
      { content_item_id: 'ig', source: 'bundle', stats: { statistics: { impressionsUnique: 145 } }, content_items: published('IG', 'instagram') },
      { content_item_id: 'li', source: 'bundle', stats: { statistics: { impressionsUnique: 37 } },  content_items: published('LI', 'linkedin') },
    ]
    const platforms = new Set(rankTopPerformers(rows, 5).map((r) => r.platform))
    expect(platforms.size).toBeGreaterThan(1)
    expect(platforms.has('instagram')).toBe(true)
    expect(platforms.has('linkedin')).toBe(true)
  })

  it('dedupes to the newest snapshot per content item', () => {
    const rows = [
      { content_item_id: 'x', source: 'ga4', stats: { pageviews: 9 }, content_items: published('X', 'blog') },
      { content_item_id: 'x', source: 'ga4', stats: { pageviews: 1 }, content_items: published('X', 'blog') },
    ]
    const top = rankTopPerformers(rows, 5)
    expect(top).toHaveLength(1)
    expect(top[0].score).toBe(9)
  })

  it('does not let an "unavailable" sentinel shadow an older real measurement', () => {
    // refresh-engagement writes this sentinel when bundle 400s with
    // `unsupported_type`. It is newest, so a plain dedupe-to-newest would claim
    // the id, score 0, and drop the item — losing the real reading behind it.
    const rows = [
      { content_item_id: 'f', source: 'bundle', content_items: published('FB post', 'facebook'),
        stats: { statistics: {}, source: 'bundle', unavailable: true, reason: 'unsupported_type' } },
      { content_item_id: 'f', source: 'bundle', content_items: published('FB post', 'facebook'),
        stats: { statistics: { impressionsUnique: 12, likes: 1 }, source: 'bundle' } },
    ]
    const top = rankTopPerformers(rows, 5)
    expect(top).toHaveLength(1)
    expect(top[0].score).toBe(12)
  })

  // Note: this one passes pre-fix too — a sentinel scores 0 and the `score <= 0`
  // filter already drops it. It is here to pin the boundary of the fix above:
  // skipping sentinels must not tip into ADMITTING an item that has never had a
  // real reading. Verified by mutation — it survives neutering isUnavailable(),
  // which is the expected result for an over-correction guard, not a gap.
  it('still drops an item whose only snapshot is an unavailable sentinel', () => {
    const rows = [
      { content_item_id: 'u', source: 'bundle', content_items: published('Never measured', 'instagram'),
        stats: { statistics: {}, source: 'bundle', unavailable: true, reason: 'unsupported_type' } },
      { content_item_id: 'k', source: 'ga4', stats: { pageviews: 2 }, content_items: published('Keep', 'blog') },
    ]
    expect(rankTopPerformers(rows, 5).map((r) => r.topic)).toEqual(['Keep'])
  })

  it('drops unpublished items and zero-scored rows', () => {
    const rows = [
      { content_item_id: 'd', source: 'ga4', stats: { pageviews: 99 }, content_items: { topic: 'Draft', platform: 'blog', status: 'draft' } },
      { content_item_id: 'z', source: 'buffer', stats: { statistics: {} }, content_items: published('Zero', 'linkedin') },
      { content_item_id: 'k', source: 'ga4', stats: { pageviews: 2 }, content_items: published('Keep', 'blog') },
    ]
    expect(rankTopPerformers(rows, 5).map((r) => r.topic)).toEqual(['Keep'])
  })

  it('returns an empty array for a non-array input', () => {
    expect(rankTopPerformers(null)).toEqual([])
    expect(rankTopPerformers(undefined)).toEqual([])
  })
})
