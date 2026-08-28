// api/_lib/citations/htmlText.js
//
// Pure HTML → plain-text extraction for a fetched web page, used by verify.js
// to get real page content to hand the judge (instead of trusting a search
// snippet). Deliberately simple (no DOM parser dependency, no new npm dep —
// per "code minimalism" in CLAUDE.md): strip script/style, strip tags, decode
// the common entities, collapse whitespace.
//
// PURE: string in, string out. No network.

const STRIP_TAGS_RE = /<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi

/**
 * Extract the <title> text from raw HTML, or null.
 * @param {string} html
 * @returns {string|null}
 */
export function extractHtmlTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  const decoded = decodeHtmlEntities(m[1]).replace(/\s+/g, ' ').trim()
  return decoded || null
}

/**
 * Strip a raw HTML document down to its visible text. Not a general-purpose
 * HTML parser — good enough to hand a judge model real page content instead of
 * markup noise. Truncated by the caller (verify.js), not here.
 * @param {string} html
 * @returns {string}
 */
export function extractHtmlText(html) {
  const withoutNonContent = String(html || '').replace(STRIP_TAGS_RE, ' ')
  const withoutTags = withoutNonContent.replace(/<[^>]+>/g, ' ')
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}
