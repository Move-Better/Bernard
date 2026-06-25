// On-page website audit — advisory-only technical SEO checks against a tenant's
// live site. Bernard SPOTS these; the tenant (or their web person) fixes them.
// There is no apply/edit path — these are suggestions, never actions.
//
// Deliberately dependency-free: a handful of robust regex checks over the raw
// HTML, not a full DOM parse. We only need presence/length signals (title, meta
// description, single H1, canonical, viewport, JSON-LD schema completeness), and
// regex keeps this loadable in any runtime with no parser dep to trace.
//
// The HTML-parsing half (auditHtml) is pure and node-harness testable on a
// static string; fetchAndAuditHomepage adds the network fetch.

const FETCH_TIMEOUT_MS = 8000

// Derive a fetchable homepage URL from a Search Console property string, which
// is either a domain property ("sc-domain:example.com") or a URL-prefix
// property ("https://example.com/"). Returns null if it can't be resolved.
export function siteHomepageUrl(gscSiteUrl) {
  if (!gscSiteUrl || typeof gscSiteUrl !== 'string') return null
  const s = gscSiteUrl.trim()
  if (s.startsWith('sc-domain:')) {
    const domain = s.slice('sc-domain:'.length).trim()
    return domain ? `https://${domain}/` : null
  }
  try {
    const u = new URL(s)
    return `${u.protocol}//${u.host}/`
  } catch {
    return null
  }
}

function firstMatch(re, html) {
  const m = re.exec(html)
  return m ? m[1] : null
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim()
}

// Pure: given page HTML + a human label (e.g. "homepage"), return advisory
// website-update suggestions. Each is { sev, source, title, why }.
//   sev ∈ 'high' | 'med' | 'low'
export function auditHtml(html, label = 'homepage') {
  const out = []
  if (!html || typeof html !== 'string') return out
  const lc = html

  // ── Title ──────────────────────────────────────────────────────────────
  const titleRaw = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, lc)
  const title = titleRaw ? stripTags(titleRaw) : null
  if (!title) {
    out.push({ sev: 'high', source: `Meta · ${label}`, title: 'Add a <title> to this page',
      why: 'The page has no title tag — Google falls back to guessing one, which usually reads poorly in search results.' })
  } else if (title.length > 60) {
    out.push({ sev: 'low', source: `Meta · ${label}`, title: `Trim the ${label} title to ~55 characters`,
      why: `At ${title.length} characters your title may get cut off in search results. Tightening it keeps the full message visible.` })
  }

  // ── Meta description ───────────────────────────────────────────────────
  // NB: presence regex has no capture group — take the whole match ([0]), then
  // pull the content attribute from it (firstMatch returns the capture group).
  const descTagMatch = /<meta[^>]+name=["']description["'][^>]*>/i.exec(lc)
  const descTag = descTagMatch ? descTagMatch[0] : null
  // Capture by matching the opening quote and reading to the SAME quote, so an
  // apostrophe inside a double-quoted value (e.g. "you don't…") isn't truncated.
  const descContent = descTag ? /content=(["'])([\s\S]*?)\1/i.exec(descTag) : null
  const desc = descContent ? descContent[2] : null
  if (!desc) {
    out.push({ sev: 'high', source: `Meta · ${label}`, title: `Add a meta description to the ${label}`,
      why: 'No meta description means Google writes its own snippet from page text — usually less compelling than one you control.' })
  } else if (desc.length < 130) {
    out.push({ sev: 'med', source: `Meta · ${label}`, title: `Lengthen the ${label} meta description (${desc.length} → ~155 chars)`,
      why: 'Your description is shorter than Google will show. Using the full space — with a reason to click and a location — earns more clicks for the same ranking.' })
  }

  // ── H1 ─────────────────────────────────────────────────────────────────
  const h1Count = (lc.match(/<h1[\s>]/gi) || []).length
  if (h1Count === 0) {
    out.push({ sev: 'med', source: `Structure · ${label}`, title: 'Add a single clear <h1> heading',
      why: 'The page has no H1. One descriptive H1 tells Google (and screen readers) what the page is primarily about.' })
  } else if (h1Count > 1) {
    out.push({ sev: 'low', source: `Structure · ${label}`, title: `Reduce to one <h1> (found ${h1Count})`,
      why: 'Multiple H1s dilute the page’s main topic signal. Keep one H1 and demote the rest to H2/H3.' })
  }

  // ── Viewport (mobile) ──────────────────────────────────────────────────
  if (!/<meta[^>]+name=["']viewport["']/i.test(lc)) {
    out.push({ sev: 'high', source: `Mobile · ${label}`, title: 'Add a responsive viewport meta tag',
      why: 'Without a viewport tag the page renders zoomed-out on phones — most local searches are mobile, and Google ranks mobile-first.' })
  }

  // ── Canonical ──────────────────────────────────────────────────────────
  if (!/<link[^>]+rel=["']canonical["']/i.test(lc)) {
    out.push({ sev: 'low', source: `Meta · ${label}`, title: 'Add a canonical link tag',
      why: 'A canonical tag tells Google which URL is the “real” one, avoiding duplicate-content splits across query-string or trailing-slash variants.' })
  }

  // ── JSON-LD structured data ────────────────────────────────────────────
  const hasJsonLd = /application\/ld\+json/i.test(lc)
  if (!hasJsonLd) {
    out.push({ sev: 'med', source: `Schema · ${label}`, title: 'Add structured data (JSON-LD) for your business',
      why: 'Structured data helps Google show your hours, location, rating and phone right in search and the Maps pack — a strong local-SEO lever you’re not using yet.' })
  } else {
    // Local business present — check for the high-value local fields that are
    // most commonly missing (we saw exactly this gap on the real site).
    const looksLocal = /"@type"\s*:\s*"(LocalBusiness|Chiropractor|MedicalBusiness|Physician|Dentist|HealthAndBeautyBusiness)"/i.test(lc)
    if (looksLocal) {
      const hasHours = /"openingHours(Specification)?"/i.test(lc)
      const hasGeo   = /"geo"\s*:/i.test(lc)
      if (!hasHours || !hasGeo) {
        const missing = [!hasHours && 'opening hours', !hasGeo && 'map coordinates'].filter(Boolean).join(' + ')
        out.push({ sev: 'high', source: `Schema · ${label}`, title: `Add ${missing} to your business schema`,
          why: `Your business schema is missing ${missing}. These feed the Google Maps / local pack — adding them helps you show up for “near me” searches.` })
      }
    }
  }

  return out
}

// Fetch the homepage and audit it. Returns { ok, url, suggestions } — never
// throws; a fetch failure yields ok:false with an empty suggestion list so the
// caller can degrade gracefully (the content opportunities still render).
export async function fetchAndAuditHomepage(gscSiteUrl) {
  const url = siteHomepageUrl(gscSiteUrl)
  if (!url) return { ok: false, url: null, suggestions: [] }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      signal:   ctrl.signal,
      redirect: 'follow',
      headers:  { 'User-Agent': 'BernardSEOBot/1.0 (+https://withbernard.ai)' },
    })
    if (!r.ok) return { ok: false, url, suggestions: [] }
    const html = await r.text()
    return { ok: true, url, suggestions: auditHtml(html, 'homepage') }
  } catch {
    return { ok: false, url, suggestions: [] }
  } finally {
    clearTimeout(timer)
  }
}
