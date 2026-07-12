// Pure, framework-free helpers for blog output hygiene. Shared by the
// frontend publish flow (src/components/story-detail/AssetsPane.jsx) and the
// server publish path (api/publish/website.js + api/_routes/publish-blog.js),
// so the two sides can never derive a slug, an SEO title, or a clean body
// differently.
//
// Background: a June 2026 SEO audit of the published blogs found defects that
// originate here, not in hand-authoring — multiple <h1> per article, <title>
// tags >95 chars, and a duplicated slug (two URLs for one article from
// run-to-run truncation drift). These helpers make each of those deterministic:
//
//   • slugifyTitle    — same title in → same slug out, capped once.
//   • deriveSeoTitle  — a ≤60-char SEO <title> distinct from the long headline.
//   • cleanBlogMarkdown — strips the redundant leading "# Headline" (the title
//     is carried separately and the page template renders the single <h1>) and
//     demotes any stray body "# " to "## " so the body never carries an <h1>.
//   • findBodyH1 / findSlugPrefixCollision — lints the publish path enforces.
//
// No imports: this module is loaded by both the Vite browser bundle and the
// Node serverless runtime, so it must stay dependency-free.

export const SLUG_MAX = 60
export const SEO_TITLE_MAX = 60
export const META_DESC_MAX = 200

// ── Slugs ───────────────────────────────────────────────────────────────────

// Deterministic slug from a title. Lowercase, collapse every run of
// non-alphanumerics to a single hyphen, trim hyphens, then cap at maxLen on a
// word (hyphen) boundary — applied EXACTLY ONCE. The same title always yields
// the same slug, which is what stops the run-to-run duplicate-URL drift.
export function slugifyTitle(title, maxLen = SLUG_MAX) {
  const raw = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (raw.length <= maxLen) return raw
  const truncated = raw.slice(0, maxLen)
  const lastHyphen = truncated.lastIndexOf('-')
  // Prefer a clean word boundary, but only when it keeps a reasonable amount of
  // the slug (an early hyphen would otherwise cut the slug down to almost
  // nothing).
  const cut = lastHyphen > maxLen / 2 ? truncated.slice(0, lastHyphen) : truncated
  return cut.replace(/-+$/g, '')
}

// Detect a truncation-prefix collision between a candidate slug and the set of
// already-published slugs. Returns the colliding existing slug, or null.
// A collision = one slug is the other extended at a hyphen boundary, e.g.
// "surgery-isnt-your-only" vs "surgery-isnt-your-only-option" — the exact shape
// of the live duplicate the audit found. Exact matches are handled by the
// existing existence check, so they're skipped here.
export function findSlugPrefixCollision(candidate, existingSlugs) {
  const c = String(candidate || '')
  if (!c) return null
  for (const existing of existingSlugs || []) {
    if (!existing || existing === c) continue
    const [shorter, longer] = c.length < existing.length ? [c, existing] : [existing, c]
    if (longer.startsWith(shorter + '-')) return existing
  }
  return null
}

// ── SEO titles ───────────────────────────────────────────────────────────────

// Smart word-boundary truncation to maxLen: no trailing partial word, no
// trailing punctuation. Whitespace is normalized first.
export function smartTruncate(text, maxLen) {
  const t = String(text || '').trim().replace(/\s+/g, ' ')
  if (t.length <= maxLen) return t
  const slice = t.slice(0, maxLen)
  const lastSpace = slice.lastIndexOf(' ')
  const cut = lastSpace > maxLen * 0.5 ? slice.slice(0, lastSpace) : slice
  return cut.replace(/[\s,;:.!?\-–—]+$/g, '').trim()
}

// Derive an SEO <title> (≤ maxLen) from the (possibly long) on-page headline.
// A headline that already fits is returned verbatim; the front of the headline
// — where the primary keyword lives — is what survives truncation.
export function deriveSeoTitle(headline, maxLen = SEO_TITLE_MAX) {
  const h = String(headline || '').trim().replace(/\s+/g, ' ')
  if (h.length <= maxLen) return h
  return smartTruncate(h, maxLen)
}

// Derive a meta description from a cleaned body: the first non-heading,
// non-image line, capped at maxLen. `fallback` (typically the SEO title) is
// used when the body has no such line yet (e.g. a fresh empty draft).
export function deriveMetaDescription(body, fallback = '', maxLen = META_DESC_MAX) {
  const line = String(body || '').split('\n').find((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l))
  const text = line?.trim() || fallback
  return smartTruncate(text, maxLen)
}

// Compose a page <title> with an optional brand suffix, never exceeding maxLen.
// The suffix is appended only if the combined string still fits, so the visible
// SERP title never overflows. Receivers decide their own suffix string.
export function composePageTitle(seoTitle, brandSuffix = '', maxLen = SEO_TITLE_MAX) {
  const base = String(seoTitle || '').trim()
  const suffix = String(brandSuffix || '')
  if (suffix && base.length + suffix.length <= maxLen) return base + suffix
  return base
}

// ── Markdown body hygiene ─────────────────────────────────────────────────────

// ATX h1: a single leading "#" then whitespace then text. "## " is NOT matched.
// Trailing closing hashes ("# Title #") are tolerated and stripped from capture.
const H1_LINE = /^#[ \t]+(.+?)[ \t]*#*\s*$/
const FENCE = /^\s*(`{3,}|~{3,})/

// Extract the headline (the first body h1) and return a cleaned body in which:
//   • the leading headline line is removed — the headline is carried separately
//     (frontmatter title) and the page template renders the one true <h1>; and
//   • any REMAINING body h1 is demoted to h2, so the published body can never
//     contribute an <h1>.
// Fenced code blocks are skipped, so a "# comment" inside ``` is left intact.
// Returns { headline, body, strippedLeadingH1, demotedCount }.
export function cleanBlogMarkdown(markdown) {
  const lines = String(markdown || '').split('\n')
  let headline = ''
  let leadingFound = false
  let demotedCount = 0
  let inFence = false
  const out = []
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const m = line.match(H1_LINE)
    if (m) {
      if (!leadingFound) {
        // First h1 = the headline. Capture it and drop the line from the body.
        headline = m[1].trim()
        leadingFound = true
        continue
      }
      // A later body h1 → demote to h2 (defense-in-depth).
      out.push(line.replace(/^#/, '##'))
      demotedCount++
      continue
    }
    out.push(line)
  }
  // Drop blank lines left at the top after removing the headline.
  while (out.length && out[0].trim() === '') out.shift()
  const body = out.join('\n').replace(/\s+$/, '') + '\n'
  return { headline, body, strippedLeadingH1: leadingFound, demotedCount }
}

// Lint: return every body h1 line (1-based line number + text) found OUTSIDE a
// fenced code block. The publish path treats a non-empty result as a hard
// failure — the title belongs in the title field, never as a body "# " heading.
export function findBodyH1(markdown) {
  const lines = String(markdown || '').split('\n')
  let inFence = false
  const hits = []
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (H1_LINE.test(lines[i])) hits.push({ line: i + 1, text: lines[i].trim() })
  }
  return hits
}
