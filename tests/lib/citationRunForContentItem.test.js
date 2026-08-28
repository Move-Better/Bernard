import { describe, it, expect, vi, beforeEach } from 'vitest'

// Isolate runCitationEnrichmentForContentItem's OWN responsibility (read the
// draft, run the pipeline, persist rows, dedupe) from the pipeline's internal
// retrieval/verify logic, which is already exhaustively covered by
// citationPipelineAntiFabrication.test.js against the real pipeline.js.
vi.mock('../../api/_lib/citations/pipeline.js', () => ({
  runCitationEnrichment: vi.fn(),
}))

import { runCitationEnrichmentForContentItem, isCitationEligiblePlatform } from '../../api/_lib/citations/runForContentItem.js'
import { runCitationEnrichment } from '../../api/_lib/citations/pipeline.js'

describe('isCitationEligiblePlatform', () => {
  it('blog (and series parts, which are also platform:blog) are eligible', () => {
    expect(isCitationEligiblePlatform('blog')).toBe(true)
  })
  it('every other platform is not — spec scope is blogs + series only', () => {
    expect(isCitationEligiblePlatform('instagram')).toBe(false)
    expect(isCitationEligiblePlatform('linkedin')).toBe(false)
    expect(isCitationEligiblePlatform(null)).toBe(false)
  })
})

describe('runCitationEnrichmentForContentItem', () => {
  const WS = 'ws-1'
  const ITEM = 'item-1'

  beforeEach(() => {
    process.env.SUPABASE_URL = 'http://localhost'
    process.env.SUPABASE_SERVICE_KEY = 'svc'
    runCitationEnrichment.mockReset()
  })

  function mockFetchSequence({ item, existingUrls = [], insertOk = true }) {
    globalThis.fetch = vi.fn(async (url, init) => {
      const u = String(url)
      if (u.includes('/content_items?')) {
        return { ok: true, json: async () => (item ? [item] : []) }
      }
      if (u.includes('/blog_citations?content_item_id=') && (!init || init.method === undefined)) {
        return { ok: true, json: async () => existingUrls.map((source_url) => ({ source_url })) }
      }
      if (u.includes('/blog_citations') && init?.method === 'POST') {
        return { ok: insertOk, text: async () => (insertOk ? '' : 'insert error') }
      }
      throw new Error(`unexpected fetch: ${u}`)
    })
  }

  it('skips non-blog platforms without running the pipeline at all', async () => {
    mockFetchSequence({ item: { id: ITEM, content: 'x', platform: 'instagram' } })
    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: false, inserted: 0, claimsConsidered: 0, reason: 'not_a_blog' })
    expect(runCitationEnrichment).not.toHaveBeenCalled()
  })

  it('skips a blog with empty content without running the pipeline', async () => {
    mockFetchSequence({ item: { id: ITEM, content: '   ', platform: 'blog' } })
    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result.reason).toBe('empty_draft')
    expect(runCitationEnrichment).not.toHaveBeenCalled()
  })

  it('reports draft_not_found when the workspace-scoped fetch finds nothing (cross-tenant read is impossible by construction)', async () => {
    mockFetchSequence({ item: null })
    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: false, inserted: 0, claimsConsidered: 0, reason: 'draft_not_found' })
  })

  it('runs the pipeline for an eligible blog and persists the accepted citations, mapped correctly', async () => {
    runCitationEnrichment.mockResolvedValue({
      citations: [{
        claim_text: 'imaging correlates poorly with pain',
        quote: 'the quote',
        source: 'pubmed',
        source_url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
        source_title: 'A Real Paper',
        source_type: 'peer_reviewed',
        why_match: 'the abstract supports it',
        confidence: 0.8,
        verify_evidence: 'the evidence excerpt',
      }],
      claimsConsidered: 1,
      rejections: [],
    })
    mockFetchSequence({ item: { id: ITEM, content: 'a real draft body', platform: 'blog' }, existingUrls: [] })

    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: true, inserted: 1, claimsConsidered: 1 })

    const insertCall = globalThis.fetch.mock.calls.find(([url, init]) => String(url).includes('/blog_citations') && init?.method === 'POST')
    const insertedRows = JSON.parse(insertCall[1].body)
    expect(insertedRows).toEqual([{
      workspace_id: WS,
      content_item_id: ITEM,
      claim_text: 'imaging correlates poorly with pain',
      claim_quote: 'the quote',
      source: 'pubmed',
      source_url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      source_title: 'A Real Paper',
      source_type: 'peer_reviewed',
      why_match: 'the abstract supports it',
      confidence: 0.8,
      verify_evidence: 'the evidence excerpt',
      status: 'suggested',
    }])
  })

  it('never re-proposes a source_url already on record for this piece (suggested, approved, OR rejected)', async () => {
    const ALREADY_KNOWN = 'https://pubmed.ncbi.nlm.nih.gov/1/'
    runCitationEnrichment.mockResolvedValue({
      citations: [
        { claim_text: 'a', quote: '', source: 'pubmed', source_url: ALREADY_KNOWN, source_title: 't', source_type: 'peer_reviewed', why_match: 'w', confidence: 0.9, verify_evidence: 'e' },
      ],
      claimsConsidered: 1,
      rejections: [],
    })
    mockFetchSequence({ item: { id: ITEM, content: 'x', platform: 'blog' }, existingUrls: [ALREADY_KNOWN] })

    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: true, inserted: 0, claimsConsidered: 1 })
    // No POST at all — nothing new to insert.
    expect(globalThis.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('reports 0 inserted (not a crash) when the insert request fails', async () => {
    runCitationEnrichment.mockResolvedValue({
      citations: [{ claim_text: 'a', quote: '', source: 'web', source_url: 'https://www.mayoclinic.org/x', source_title: 't', source_type: 'major_institution', why_match: 'w', confidence: 0.9, verify_evidence: 'e' }],
      claimsConsidered: 1,
      rejections: [],
    })
    mockFetchSequence({ item: { id: ITEM, content: 'x', platform: 'blog' }, existingUrls: [], insertOk: false })
    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: true, inserted: 0, claimsConsidered: 1, reason: 'insert_failed' })
  })

  it('reports 0 inserted with no DB writes when the pipeline finds nothing to cite', async () => {
    runCitationEnrichment.mockResolvedValue({ citations: [], claimsConsidered: 2, rejections: [] })
    mockFetchSequence({ item: { id: ITEM, content: 'x', platform: 'blog' } })
    const result = await runCitationEnrichmentForContentItem({ workspaceId: WS, contentItemId: ITEM })
    expect(result).toEqual({ ran: true, inserted: 0, claimsConsidered: 2 })
    // Only the content_items read happened — no existing-urls lookup, no insert.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})
