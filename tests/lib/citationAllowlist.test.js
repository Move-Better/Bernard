import { describe, it, expect } from 'vitest'
import { isAllowedCitationUrl, tierForHostname, hostnameOf, CITATION_ALLOWLIST_DOMAINS } from '../../api/_lib/citations/allowlist.js'

describe('citation source allowlist', () => {
  it('allows every tier from the spec (pubmed, semantic scholar, mayo, aca, healthline, etc.)', () => {
    expect(isAllowedCitationUrl('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toBe(true)
    expect(isAllowedCitationUrl('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123456/')).toBe(true)
    expect(isAllowedCitationUrl('https://www.semanticscholar.org/paper/abc123')).toBe(true)
    expect(isAllowedCitationUrl('https://www.cochranelibrary.com/cdsr/doi/xyz')).toBe(true)
    expect(isAllowedCitationUrl('https://www.mayoclinic.org/diseases-conditions/x')).toBe(true)
    expect(isAllowedCitationUrl('https://my.clevelandclinic.org/health/x')).toBe(true)
    expect(isAllowedCitationUrl('https://www.nih.gov/news/x')).toBe(true)
    expect(isAllowedCitationUrl('https://www.acatoday.org/patients/x')).toBe(true)
    expect(isAllowedCitationUrl('https://www.animalchiropractic.org/x')).toBe(true)
    expect(isAllowedCitationUrl('https://www.healthline.com/health/x')).toBe(true)
    expect(isAllowedCitationUrl('https://www.webmd.com/x')).toBe(true)
    expect(isAllowedCitationUrl('https://medlineplus.gov/x')).toBe(true)
  })

  it('rejects a non-allowlisted domain even when it LOOKS medical', () => {
    // A domain that merely sounds authoritative (a competitor clinic, a
    // content farm dressed up as a health site) must still be rejected — the
    // gate is the domain, never vibes.
    expect(isAllowedCitationUrl('https://totally-legit-health-facts.com/article')).toBe(false)
    expect(isAllowedCitationUrl('https://a-competitor-chiropractic-clinic.com/blog')).toBe(false)
  })

  it('a subdomain of an allowlisted domain is allowed; a lookalike is not', () => {
    expect(isAllowedCitationUrl('https://pmc.ncbi.nlm.nih.gov/articles/x')).toBe(true)
    // "notmayoclinic.org" contains "mayoclinic.org" as a substring, but is NOT
    // a subdomain of it — must be rejected, or the gate is trivially bypassable.
    expect(isAllowedCitationUrl('https://notmayoclinic.org/x')).toBe(false)
    expect(isAllowedCitationUrl('https://mayoclinic.org.evil.com/x')).toBe(false)
  })

  it('rejects malformed / non-URL input without throwing', () => {
    expect(isAllowedCitationUrl('not a url')).toBe(false)
    expect(isAllowedCitationUrl('')).toBe(false)
    expect(isAllowedCitationUrl(null)).toBe(false)
    expect(isAllowedCitationUrl(undefined)).toBe(false)
  })

  it('strips www. and lowercases when resolving a hostname', () => {
    expect(hostnameOf('https://WWW.MayoClinic.org/x')).toBe('mayoclinic.org')
    expect(hostnameOf('not a url')).toBe(null)
  })

  it('tierForHostname classifies each tier correctly', () => {
    expect(tierForHostname('pubmed.ncbi.nlm.nih.gov')).toBe('peer_reviewed')
    expect(tierForHostname('mayoclinic.org')).toBe('major_institution')
    expect(tierForHostname('acatoday.org')).toBe('professional_guidelines')
    expect(tierForHostname('healthline.com')).toBe('reputable_health_ed')
    expect(tierForHostname('example.com')).toBe(null)
  })

  it('the allowlist is a single flat list with no accidental duplicates', () => {
    expect(new Set(CITATION_ALLOWLIST_DOMAINS).size).toBe(CITATION_ALLOWLIST_DOMAINS.length)
    expect(CITATION_ALLOWLIST_DOMAINS.length).toBeGreaterThan(5)
  })
})
