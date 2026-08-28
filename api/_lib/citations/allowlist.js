// api/_lib/citations/allowlist.js
//
// The source allowlist for blog/series research citations (spec: Q, 2026-08-27,
// .claude/blog-research-citations-spec.md — "Source policy"). A citation MUST
// resolve to one of these domains or it is rejected outright, REGARDLESS of
// what the verification judge says. This is a hard gate, not advisory — see
// `isAllowedCitationUrl` below and its use in api/_lib/citations/pipeline.js.
//
// PURE: no env, no network, no side effects. Kept in one file (per CLAUDE.md's
// "PATCH allowlists are camelCase" / "put a list in one config file" doctrine)
// so it's easy to extend without hunting for scattered copies.

// Tiered only for documentation/attribution purposes (source_type on a
// blog_citations row) — the allowlist check itself doesn't care which tier a
// domain is in, all tiers gate identically.
export const CITATION_SOURCE_TIERS = {
  peer_reviewed: [
    'pubmed.ncbi.nlm.nih.gov',
    'ncbi.nlm.nih.gov', // PMC
    'semanticscholar.org',
    'cochranelibrary.com',
  ],
  major_institution: [
    'mayoclinic.org',
    'clevelandclinic.org',
    'nih.gov',
  ],
  professional_guidelines: [
    'acatoday.org', // American Chiropractic Association
    'animalchiropractic.org', // AVCA — equine/animal workspaces
  ],
  // Only where the specific page cites primary research — the allowlist can't
  // enforce that nuance (it's a domain check), so the verify step's judge
  // prompt is told to weight these more skeptically. See verifyRubric.js.
  reputable_health_ed: [
    'healthline.com',
    'webmd.com',
    'medlineplus.gov',
  ],
}

export const CITATION_ALLOWLIST_DOMAINS = Object.values(CITATION_SOURCE_TIERS).flat()

/**
 * Which tier a domain belongs to (for source_type / display), or null.
 * @param {string} hostname — already-normalized (no www., lowercase)
 */
export function tierForHostname(hostname) {
  for (const [tier, domains] of Object.entries(CITATION_SOURCE_TIERS)) {
    if (domains.some((d) => hostMatchesDomain(hostname, d))) return tier
  }
  return null
}

function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Normalize a URL's hostname the way the rest of the codebase does
 * (clinicDomains/hostnameOf in citationProbe.js): lowercase, strip a leading
 * www., ignore anything unparsable.
 * @param {string} url
 * @returns {string|null}
 */
export function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

/**
 * The hard allowlist gate. A candidate citation URL must pass this check
 * before it can EVER reach a suggested/approved row, independent of whatever
 * the verification judge said. Judge says "supports" on a non-allowlisted
 * domain → still rejected. This is enforced in the pipeline (pipeline.js),
 * never left to the judge's discretion.
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedCitationUrl(url) {
  const host = hostnameOf(url)
  if (!host) return false
  return CITATION_ALLOWLIST_DOMAINS.some((d) => hostMatchesDomain(host, d))
}
