import { describe, it, expect } from 'vitest'
import { rerankToAllowlist } from '../../api/_lib/citations/webSearchClient.js'

describe('web search rerankToAllowlist — the "restricted to the allowlist" enforcement', () => {
  it('drops every URL not on the allowlist, keeps the ones that are', () => {
    const urls = [
      'https://www.mayoclinic.org/diseases-conditions/x',
      'https://some-random-blog.com/opinion-piece',
      'https://www.acatoday.org/patients/x',
      'https://a-competitor-clinic.com/blog',
    ]
    expect(rerankToAllowlist(urls)).toEqual([
      'https://www.mayoclinic.org/diseases-conditions/x',
      'https://www.acatoday.org/patients/x',
    ])
  })

  it('dedupes repeated URLs', () => {
    const urls = ['https://www.mayoclinic.org/a', 'https://www.mayoclinic.org/a']
    expect(rerankToAllowlist(urls)).toEqual(['https://www.mayoclinic.org/a'])
  })

  it('caps to max', () => {
    const urls = [
      'https://www.mayoclinic.org/a',
      'https://www.clevelandclinic.org/b',
      'https://www.nih.gov/c',
      'https://www.acatoday.org/d',
    ]
    expect(rerankToAllowlist(urls, { max: 2 })).toHaveLength(2)
  })

  it('returns [] for empty/garbage input, never throws', () => {
    expect(rerankToAllowlist([])).toEqual([])
    expect(rerankToAllowlist(null)).toEqual([])
    expect(rerankToAllowlist([null, undefined, 42, ''])).toEqual([])
  })

  it('if EVERY cited url is off-allowlist, the result is empty — the web source can legitimately return nothing', () => {
    expect(rerankToAllowlist(['https://random-site.com/a', 'https://other.com/b'])).toEqual([])
  })
})
