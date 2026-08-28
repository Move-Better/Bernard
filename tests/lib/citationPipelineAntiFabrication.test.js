import { describe, it, expect } from 'vitest'
import { runCitationEnrichment } from '../../api/_lib/citations/pipeline.js'

// ─────────────────────────────────────────────────────────────────────────────
// THE anti-fabrication guard suite. This proves the spec's one invariant:
//
//   "A research citation URL must NEVER be emitted from the model's own
//   memory/training data. Every link that ships must trace back to a real
//   API result and pass content-level verification."
//
// Every test here is written to FAIL if the guard it's checking were removed
// — before writing pipeline.js's implementation, these were run against a
// deliberately naive version that read a `url` field off the judge's verdict
// (simulating "trust the model"), and every fabrication test below went red,
// which is what proves they're not vacuous. See the inline notes on each.
// ─────────────────────────────────────────────────────────────────────────────

const okContent = () => ({ content: 'x'.repeat(100), title: 'Real Title', fetchOk: true })
const alwaysSupports = async () => ({ support: true, confidence: 0.9, why: 'supports the claim' })

function oneClaimExtractor(claimText = 'imaging correlates poorly with pain') {
  return async () => [{ claim_text: claimText, quote: 'some quote' }]
}

describe('runCitationEnrichment — zero-claims short-circuit', () => {
  it('returns no citations and makes zero retrieval/judge calls when there is nothing to cite', async () => {
    let retrieveCalled = false
    let judgeCalled = false
    const result = await runCitationEnrichment({
      draftBody: 'a personal story with nothing citation-worthy',
      extractClaimsFn: async () => [],
      retrieveFns: [async () => { retrieveCalled = true; return [] }],
      fetchContentFn: okContent,
      judgeFn: async () => { judgeCalled = true; return { support: true, confidence: 1, why: '' } },
    })
    expect(result.citations).toEqual([])
    expect(result.claimsConsidered).toBe(0)
    expect(retrieveCalled).toBe(false)
    expect(judgeCalled).toBe(false)
  })
})

describe('runCitationEnrichment — THE anti-fabrication guard', () => {
  it('a citation URL never returned by retrieval cannot reach the output, even when the judge tries to smuggle one', async () => {
    const REAL_URL = 'https://pubmed.ncbi.nlm.nih.gov/42657933/'
    const FABRICATED_URL = 'https://pubmed.ncbi.nlm.nih.gov/00000000/' // a plausible-looking PMID the judge "recalls" — exactly the original bug's shape

    // A hallucinating/malicious judge: it agrees the claim is supported, but
    // tries to attach a DIFFERENT url than the one it was actually shown. If
    // pipeline.js ever read a url off the judge's return value, this would
    // leak through.
    const smugglingJudge = async () => ({
      support: true,
      confidence: 0.95,
      why: 'supports it',
      url: FABRICATED_URL, // pipeline.js must never read this
    })

    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'pubmed', url: REAL_URL, title: 'A Real Paper', abstract: 'real abstract content here that is long enough' }]],
      fetchContentFn: okContent,
      judgeFn: smugglingJudge,
    })

    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].source_url).toBe(REAL_URL)
    expect(result.citations[0].source_url).not.toBe(FABRICATED_URL)
    // Prove the fabricated value doesn't leak anywhere on the citation record,
    // not just the source_url field.
    expect(JSON.stringify(result.citations[0])).not.toContain(FABRICATED_URL)
  })

  it('a candidate that retrieval never returned literally cannot exist in the pipeline — the retrieval array IS the universe of possible URLs', async () => {
    // Structural proof by exhaustion: retrieval returns exactly one candidate;
    // regardless of what the judge or claim extractor say, the ONLY possible
    // source_url in the output is that one candidate's url.
    const ONLY_CANDIDATE_URL = 'https://www.mayoclinic.org/diseases-conditions/x'
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'web', url: ONLY_CANDIDATE_URL, title: null }]],
      fetchContentFn: okContent,
      judgeFn: alwaysSupports,
    })
    for (const citation of result.citations) {
      expect(citation.source_url).toBe(ONLY_CANDIDATE_URL)
    }
  })
})

describe('runCitationEnrichment — the allowlist gate overrides the judge', () => {
  it('rejects a non-allowlisted domain even when the judge says it supports the claim — and never even calls the judge for it', async () => {
    let judgeCallCount = 0
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'web', url: 'https://not-on-the-allowlist.com/article', title: 'x' }]],
      fetchContentFn: okContent,
      judgeFn: async () => { judgeCallCount++; return { support: true, confidence: 1, why: 'x' } },
    })
    expect(result.citations).toEqual([])
    expect(judgeCallCount).toBe(0)
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'not_allowlisted' }))
  })
})

describe('runCitationEnrichment — dead/unreachable links fail closed', () => {
  it('rejects a candidate whose content could not be fetched, without ever calling the judge', async () => {
    let judgeCallCount = 0
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'x', abstract: '' }]],
      fetchContentFn: async () => ({ content: '', title: null, fetchOk: false }),
      judgeFn: async () => { judgeCallCount++; return { support: true, confidence: 1, why: 'x' } },
    })
    expect(result.citations).toEqual([])
    expect(judgeCallCount).toBe(0)
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'unreachable_or_empty' }))
  })

  it('rejects a candidate whose fetched content is too short to genuinely support anything', async () => {
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'x', abstract: '' }]],
      fetchContentFn: async () => ({ content: 'too short', title: 'x', fetchOk: true }),
      judgeFn: alwaysSupports,
    })
    expect(result.citations).toEqual([])
  })
})

describe('runCitationEnrichment — verification is not rubber-stamping', () => {
  it('rejects when the judge rules the real content does NOT support the claim', async () => {
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'A paper about something else entirely', abstract: 'this paper is actually about unrelated topic Y' }]],
      fetchContentFn: okContent,
      judgeFn: async () => ({ support: false, confidence: 0.9, why: 'This paper discusses an unrelated condition.' }),
    })
    expect(result.citations).toEqual([])
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'not_supported' }))
  })

  it('fails CLOSED (rejects) when the judge response is unparseable — an unparseable verdict is never treated as support', async () => {
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'x', abstract: 'y' }]],
      fetchContentFn: okContent,
      judgeFn: async () => null, // simulates parseVerifyResult() returning null
    })
    expect(result.citations).toEqual([])
    expect(result.rejections).toContainEqual(expect.objectContaining({ reason: 'judge_unparseable' }))
  })
})

describe('runCitationEnrichment — cite sparingly (0-3 per post, highest confidence)', () => {
  it('caps to maxCitations across the WHOLE post, not per claim', async () => {
    const claims = [
      { claim_text: 'claim A', quote: 'qA' },
      { claim_text: 'claim B', quote: 'qB' },
      { claim_text: 'claim C', quote: 'qC' },
    ]
    let n = 0
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: async () => claims,
      retrieveFns: [async (claimText) => {
        n++
        return [{ source: 'pubmed', url: `https://pubmed.ncbi.nlm.nih.gov/${n}/`, title: `paper for ${claimText}`, abstract: 'real abstract content long enough to pass the min length' }]
      }],
      fetchContentFn: okContent,
      // vary confidence so the sort order is verifiable
      judgeFn: async ({ claimText }) => ({
        support: true,
        confidence: claimText === 'claim A' ? 0.5 : claimText === 'claim B' ? 0.95 : 0.7,
        why: 'x',
      }),
      maxCitations: 2,
    })
    expect(result.citations).toHaveLength(2)
    // highest confidence first, and the lowest (claim A, 0.5) is dropped
    expect(result.citations[0].claim_text).toBe('claim B')
    expect(result.citations[1].claim_text).toBe('claim C')
    expect(result.citations.some((c) => c.claim_text === 'claim A')).toBe(false)
  })

  it('a claim with no genuinely supporting source ships with NO link — a correct outcome, not a failure', async () => {
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => []], // nothing found at all
      fetchContentFn: okContent,
      judgeFn: alwaysSupports,
    })
    expect(result.citations).toEqual([])
    expect(result.claimsConsidered).toBe(1)
  })
})

describe('runCitationEnrichment — multi-source behavior', () => {
  it('isolates a failing retrieval source — one source throwing does not kill candidates from another', async () => {
    const goodUrl = 'https://www.mayoclinic.org/x'
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [
        async () => { throw new Error('pubmed_esearch_500') },
        async () => [{ source: 'web', url: goodUrl, title: null }],
      ],
      fetchContentFn: okContent,
      judgeFn: alwaysSupports,
    })
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].source_url).toBe(goodUrl)
  })

  it('dedupes the same URL returned by two different sources — verifies/judges it only once', async () => {
    const sameUrl = 'https://www.mayoclinic.org/x'
    let fetchCallCount = 0
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [
        async () => [{ source: 'web', url: sameUrl, title: null }],
        async () => [{ source: 'web', url: sameUrl, title: null }],
      ],
      fetchContentFn: async (c) => { fetchCallCount++; return okContent(c) },
      judgeFn: alwaysSupports,
    })
    expect(fetchCallCount).toBe(1)
    expect(result.citations).toHaveLength(1)
  })

  it('caps candidates considered per claim (maxCandidatesPerClaim)', async () => {
    let fetchCallCount = 0
    const manyUrls = Array.from({ length: 10 }, (_, i) => ({ source: 'pubmed', url: `https://pubmed.ncbi.nlm.nih.gov/${i}/`, title: `t${i}`, abstract: 'real content long enough' }))
    await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => manyUrls],
      fetchContentFn: async (c) => { fetchCallCount++; return okContent(c) },
      judgeFn: alwaysSupports,
      maxCandidatesPerClaim: 3,
    })
    expect(fetchCallCount).toBe(3)
  })
})

describe('runCitationEnrichment — audit trail', () => {
  it('every accepted citation carries claim_text, why_match, confidence, and a verify_evidence excerpt for the human reviewer', async () => {
    const result = await runCitationEnrichment({
      draftBody: 'a blog post',
      extractClaimsFn: oneClaimExtractor('mechanism claim'),
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'Real Paper', abstract: 'a real abstract with enough content to pass the length check' }]],
      fetchContentFn: okContent,
      judgeFn: async () => ({ support: true, confidence: 0.77, why: 'The abstract directly supports this.' }),
    })
    expect(result.citations[0]).toMatchObject({
      claim_text: 'mechanism claim',
      source: 'pubmed',
      source_title: 'Real Title', // from fetchContentFn's real title, not retrieval's placeholder
      why_match: 'The abstract directly supports this.',
      confidence: 0.77,
    })
    expect(result.citations[0].verify_evidence.length).toBeGreaterThan(0)
  })
})
