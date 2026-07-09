// Shared week/month/year period math for the Insights page's period picker.
// All three granularities use UTC calendar boundaries so "this week/month/year"
// means the same thing across the Social, Website, and SEO tabs — mirrored
// client-side in src/lib/periodMath.js for label rendering.

export const GRANULARITIES = ['week', 'month', 'year']

// How far Prev can go, per granularity (0 = current period).
export const MAX_OFFSET = { week: -8, month: -12, year: -3 }

function weekBounds(offset) {
  const start = new Date()
  const dow = (start.getUTCDay() + 6) % 7 // 0 = Monday
  start.setUTCDate(start.getUTCDate() - dow + offset * 7)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  return { start, end }
}

function monthBounds(offset) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  return { start, end }
}

function yearBounds(offset) {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear() + offset, 0, 1))
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1))
  return { start, end }
}

// Returns { start, end, granularity, offset } for the given granularity +
// offset (0 = current period, negative = past). `end` is exclusive.
// Invalid granularity falls back to 'week'; offset is clamped to MAX_OFFSET.
export function periodBounds(granularity, offset) {
  const g = GRANULARITIES.includes(granularity) ? granularity : 'week'
  const clamped = Math.max(MAX_OFFSET[g], Math.min(0, Number.parseInt(offset, 10) || 0))
  const bounds = g === 'month' ? monthBounds(clamped) : g === 'year' ? yearBounds(clamped) : weekBounds(clamped)
  return { ...bounds, granularity: g, offset: clamped }
}

// YYYY-MM-DD, UTC — for APIs (GA4, GSC) that take date-only strings.
export function toDateStr(d) {
  return d.toISOString().slice(0, 10)
}
