// Move Better's Google review totals, read live from the private Movebetterco repo.
//
// Contract: docs/reviews/README.md in Move-Better/Movebetterco. Read only. This helper surfaces ONLY the
// per-clinic rating and count from the file's `locations` block: no review text, reviewer names or photos,
// so it never touches the patient-story / PHI rule. Bernard stores nothing; see
// .claude/lessons/integrations.md "Google reviews come from the Movebetterco repo".

const FILE_URL =
  'https://api.github.com/repos/Move-Better/Movebetterco/contents/data/google-reviews.json?ref=main'
const TTL_MS = 60 * 60 * 1000 // the file is refreshed quarterly; an hour is plenty

// ponytail: these are Move Better's own reviews, so only its workspace gets them. Bernard has no per-tenant
// flag for this. Upgrade path: a workspaces column or capability if a second tenant ever gets a source.
export const REVIEWS_WORKSPACES = new Set(['movebetter'])

const LABELS = { portland: 'Portland', vancouver: 'Vancouver' }

const validStat = (s) =>
  s && typeof s.rating === 'number' && s.rating >= 0 && s.rating <= 5 && Number.isInteger(s.count) && s.count >= 0

// Pure: the parsed JSON file -> what the Analytics card shows, or null when the file is not the expected shape.
export function shapeSummary(file) {
  const locs = file?.locations
  if (!locs || typeof locs !== 'object') return null
  const rows = Object.entries(locs)
    .filter(([, s]) => validStat(s))
    .map(([key, s]) => ({ key, label: LABELS[key] || key, rating: s.rating, count: s.count }))
  if (!rows.length) return null
  const count = rows.reduce((n, r) => n + r.count, 0)
  const rating = count ? rows.reduce((n, r) => n + r.rating * r.count, 0) / count : 0
  return { updated: typeof file.updated === 'string' ? file.updated : null, locations: rows, combined: { rating, count } }
}

let cached = null // { at, value }

// Returns the summary, or null on any failure (missing token, 404, bad JSON, bad shape). Failures are not cached.
export async function getReviewsSummary({ fetchImpl = fetch, token = process.env.GITHUB_REVIEWS_TOKEN, now = Date.now() } = {}) {
  if (cached && now - cached.at < TTL_MS) return cached.value
  if (!token) return null
  try {
    const r = await fetchImpl(FILE_URL, {
      headers: { Accept: 'application/vnd.github.raw+json', Authorization: `Bearer ${token}`, 'User-Agent': 'bernard' },
    })
    if (!r.ok) {
      console.error('[google-reviews] fetch failed:', r.status)
      return null
    }
    const value = shapeSummary(await r.json())
    if (value) cached = { at: now, value }
    return value
  } catch (e) {
    console.error('[google-reviews] fetch error:', e?.message)
    return null
  }
}

// Test seam only.
export function _resetReviewsCache() { cached = null }
