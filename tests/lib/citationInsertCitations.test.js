import { describe, it, expect } from 'vitest'
import { insertApprovedCitations } from '../../api/_lib/citations/insertCitations.js'

describe('insertApprovedCitations', () => {
  it('returns the markdown unchanged when there are no approved citations', () => {
    const body = '# Headline\n\nSome real content.'
    expect(insertApprovedCitations(body, [])).toBe(body)
    expect(insertApprovedCitations(body, null)).toBe(body)
    expect(insertApprovedCitations(body, undefined)).toBe(body)
  })

  it('appends a Further reading section with descriptive anchor text — never "click here"', () => {
    const body = '# Headline\n\nSome real content.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://pubmed.ncbi.nlm.nih.gov/1/', source_title: 'A Real Paper Title' },
    ])
    expect(out).toContain('Some real content.')
    expect(out).toContain('## Further reading')
    expect(out).toContain('[A Real Paper Title](https://pubmed.ncbi.nlm.nih.gov/1/)')
    expect(out).not.toMatch(/click here/i)
  })

  it('lists multiple approved citations in order, one per line', () => {
    const out = insertApprovedCitations('body', [
      { source_url: 'https://www.mayoclinic.org/a', source_title: 'Mayo Page' },
      { source_url: 'https://pubmed.ncbi.nlm.nih.gov/2/', source_title: 'Pubmed Paper' },
    ])
    const lines = out.split('\n').filter((l) => l.startsWith('- ['))
    expect(lines).toEqual([
      '- [Mayo Page](https://www.mayoclinic.org/a)',
      '- [Pubmed Paper](https://pubmed.ncbi.nlm.nih.gov/2/)',
    ])
  })

  it('falls back to the hostname as anchor text when no title was captured — never invents one', () => {
    const out = insertApprovedCitations('body', [{ source_url: 'https://www.healthline.com/x', source_title: null }])
    expect(out).toContain('[healthline.com](https://www.healthline.com/x)')
  })

  it('never appends a heading level other than ## — must not trip the body-h1 lint gate', () => {
    const out = insertApprovedCitations('# Headline', [{ source_url: 'https://www.mayoclinic.org/a', source_title: 'x' }])
    expect(out).not.toMatch(/\n# [^#]/) // no NEW single-# line was introduced
  })

  it('drops a malformed citation object missing source_url rather than throwing', () => {
    const out = insertApprovedCitations('body', [{ source_title: 'no url here' }, { source_url: 'https://www.mayoclinic.org/a', source_title: 'Real' }])
    expect(out).toContain('- [Real](https://www.mayoclinic.org/a)')
    expect(out.match(/^- \[/gm)).toHaveLength(1)
  })
})

// "Link placement — LOCKED 2026-08-28" (.claude/blog-research-citations-spec.md):
// inline AND footer, deliberate redundancy — inline only on an exact,
// case-sensitive, single-occurrence match; anything else degrades to
// footer-only for that one citation. See tests/lib/citationQuoteMatch.test.js
// for the shared matcher's own unit tests; these guards prove insertCitations
// wires that matcher in correctly at the insertion layer.
describe('insertApprovedCitations — inline + footer (Link placement, locked 2026-08-28)', () => {
  it('exact single-occurrence match: wraps the quote inline AND still appends the footer entry', () => {
    const body = 'Intro. Imaging findings correlate poorly with reported pain levels. Outro.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://pubmed.ncbi.nlm.nih.gov/1/', source_title: 'A Real Paper', claim_quote: 'Imaging findings correlate poorly with reported pain levels.' },
    ])
    expect(out).toContain('[Imaging findings correlate poorly with reported pain levels.](https://pubmed.ncbi.nlm.nih.gov/1/)')
    expect(out).toContain('## Further reading')
    expect(out).toContain('- [A Real Paper](https://pubmed.ncbi.nlm.nih.gov/1/)')
  })

  it('a case-mismatched quote does NOT inline — footer-only fallback, never a fuzzy substitute', () => {
    const body = 'Intro. IMAGING FINDINGS CORRELATE POORLY WITH PAIN. Outro.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://pubmed.ncbi.nlm.nih.gov/1/', source_title: 'A Real Paper', claim_quote: 'imaging findings correlate poorly with pain' },
    ])
    // exactly one occurrence of the link in the whole output — the footer's;
    // no second, inline occurrence was inserted mid-body
    expect(out.split('](https://pubmed.ncbi.nlm.nih.gov/1/)')).toHaveLength(2)
    expect(out).toContain('## Further reading')
    expect(out).toContain('- [A Real Paper](https://pubmed.ncbi.nlm.nih.gov/1/)')
    expect(out.startsWith(body)).toBe(true) // body untouched, footer only appended after it
  })

  it('a partially-matching quote (different punctuation/wording than captured) does NOT inline — footer-only', () => {
    const body = 'Rest is not always best for recovery, generally speaking these days.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://www.mayoclinic.org/a', source_title: 'Mayo Page', claim_quote: 'rest is not always best for recovery' },
    ])
    expect(out).toBe(`${body}\n\n## Further reading\n\n- [Mayo Page](https://www.mayoclinic.org/a)\n`)
  })

  it('a quote appearing more than once is ambiguous — footer-only, never guesses which occurrence', () => {
    const body = 'Move early. Later in the post: move early, always move early.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://www.mayoclinic.org/a', source_title: 'Mayo Page', claim_quote: 'move early' },
    ])
    // body is completely unchanged except for the appended footer
    expect(out.startsWith(body)).toBe(true)
    expect(out).toContain('## Further reading')
    expect(out).toContain('- [Mayo Page](https://www.mayoclinic.org/a)')
  })

  it('a quote that does not appear at all (body hand-edited since enrichment) — footer-only, no crash', () => {
    const body = 'The body was completely rewritten by the clinician before approval.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://www.mayoclinic.org/a', source_title: 'Mayo Page', claim_quote: 'a sentence that no longer exists anywhere in the body' },
    ])
    expect(out.startsWith(body)).toBe(true)
    expect(out).toContain('- [Mayo Page](https://www.mayoclinic.org/a)')
  })

  it('inlining never alters a single character outside the matched span (byte-diff)', () => {
    const before = 'Header line.\n\nParagraph one. The claim sentence sits right here. Paragraph two continues on.\n\nFooter line.'
    const citation = { source_url: 'https://www.mayoclinic.org/a', source_title: 'Mayo Page', claim_quote: 'The claim sentence sits right here.' }
    const after = insertApprovedCitations(before, [citation])

    const matchIdx = before.indexOf(citation.claim_quote)
    const beforePrefix = before.slice(0, matchIdx)
    const beforeSuffixFromBody = before.slice(matchIdx + citation.claim_quote.length)

    // Split the published body away from the appended footer to isolate the
    // body-only diff.
    const bodyOnly = after.slice(0, after.indexOf('\n\n## Further reading'))
    expect(bodyOnly.startsWith(beforePrefix)).toBe(true)
    expect(bodyOnly.endsWith(beforeSuffixFromBody)).toBe(true)
    // Everything between the two unchanged halves is exactly the wrapped span.
    const middle = bodyOnly.slice(beforePrefix.length, bodyOnly.length - beforeSuffixFromBody.length)
    expect(middle).toBe(`[${citation.claim_quote}](${citation.source_url})`)
  })

  it('the footer entry is appended whether inline succeeds or fails — footer never depends on inline outcome', () => {
    const bodyInlineOk = 'The claim sentence sits here.'
    const outOk = insertApprovedCitations(bodyInlineOk, [
      { source_url: 'https://x.mayoclinic.org/a', source_title: 'Inline Works', claim_quote: 'The claim sentence sits here.' },
    ])
    const bodyInlineFail = 'A totally different body with no matching text at all.'
    const outFail = insertApprovedCitations(bodyInlineFail, [
      { source_url: 'https://x.mayoclinic.org/a', source_title: 'Inline Fails', claim_quote: 'a quote that is nowhere in this body' },
    ])
    expect(outOk).toContain('## Further reading')
    expect(outOk).toContain('- [Inline Works](https://x.mayoclinic.org/a)')
    expect(outFail).toContain('## Further reading')
    expect(outFail).toContain('- [Inline Fails](https://x.mayoclinic.org/a)')
  })

  it('a citation with no claim_quote at all (older row) is footer-only, not a crash', () => {
    const body = 'Some body text.'
    const out = insertApprovedCitations(body, [{ source_url: 'https://www.mayoclinic.org/a', source_title: 'No Quote' }])
    expect(out).toBe(`${body}\n\n## Further reading\n\n- [No Quote](https://www.mayoclinic.org/a)\n`)
  })

  it('multiple approved citations: each is matched independently against the progressively-updated body', () => {
    const body = 'First claim sentence. Second claim sentence.'
    const out = insertApprovedCitations(body, [
      { source_url: 'https://a.mayoclinic.org/1', source_title: 'First', claim_quote: 'First claim sentence.' },
      { source_url: 'https://a.mayoclinic.org/2', source_title: 'Second', claim_quote: 'Second claim sentence.' },
    ])
    expect(out).toContain('[First claim sentence.](https://a.mayoclinic.org/1)')
    expect(out).toContain('[Second claim sentence.](https://a.mayoclinic.org/2)')
    expect(out).toContain('- [First](https://a.mayoclinic.org/1)')
    expect(out).toContain('- [Second](https://a.mayoclinic.org/2)')
  })
})
