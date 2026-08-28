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
