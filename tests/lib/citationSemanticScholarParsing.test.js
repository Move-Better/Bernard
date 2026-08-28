import { describe, it, expect } from 'vitest'
import { parseSearchResponse } from '../../api/_lib/citations/semanticScholarClient.js'

// Shape captured from a real (though rate-limited on the anonymous tier) call
// to api.semanticscholar.org/graph/v1/paper/search 2026-08-27 — this is the
// documented response shape for that endpoint's `data` array.
describe('semantic scholar search response parsing', () => {
  it('parses real-shaped results into candidates with a real url/title/abstract', () => {
    const json = {
      data: [
        {
          paperId: 'abc123',
          title: 'Effectiveness of spinal manipulation for chronic low back pain',
          abstract: 'This systematic review examines...',
          url: 'https://www.semanticscholar.org/paper/abc123',
          externalIds: { DOI: '10.1000/xyz' },
        },
      ],
    }
    const candidates = parseSearchResponse(json)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      source: 'semantic_scholar',
      paperId: 'abc123',
      title: 'Effectiveness of spinal manipulation for chronic low back pain',
      url: 'https://www.semanticscholar.org/paper/abc123',
    })
  })

  it('drops a result with no title or no url — unusable as a citation candidate', () => {
    const json = { data: [{ paperId: 'x', abstract: 'stuff' }, { title: 'y', url: null }] }
    expect(parseSearchResponse(json)).toEqual([])
  })

  it('degrades gracefully on an empty/malformed response', () => {
    expect(parseSearchResponse({})).toEqual([])
    expect(parseSearchResponse(null)).toEqual([])
    expect(parseSearchResponse({ data: null })).toEqual([])
  })

  it('missing abstract becomes an empty string, not undefined (so downstream length checks are safe)', () => {
    const json = { data: [{ title: 'x', url: 'https://www.semanticscholar.org/paper/y' }] }
    expect(parseSearchResponse(json)[0].abstract).toBe('')
  })
})
