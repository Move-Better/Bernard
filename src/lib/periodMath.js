// Client-side mirror of api/_lib/periodMath.js — same UTC calendar-boundary
// math, so "this week/month/year" agrees between what the SPA renders as a
// label and what the server actually queried.

export const GRANULARITIES = ['week', 'month', 'year']

// How far Prev can go, per granularity (0 = current period). Mirrors the
// server's MAX_OFFSET so the nav button disables at the same point the
// backend would otherwise clamp.
export const MAX_OFFSET = { week: -8, month: -12, year: -3 }

function weekBounds(offset) {
  const start = new Date()
  const dow = (start.getUTCDay() + 6) % 7
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

export function periodBounds(granularity, offset) {
  const g = GRANULARITIES.includes(granularity) ? granularity : 'week'
  const clamped = Math.max(MAX_OFFSET[g], Math.min(0, Number(offset) || 0))
  const bounds = g === 'month' ? monthBounds(clamped) : g === 'year' ? yearBounds(clamped) : weekBounds(clamped)
  return { ...bounds, granularity: g, offset: clamped }
}

// Human label for the period, e.g. "Jul 6 – 12", "July 2026", "2026".
export function periodLabel(granularity, offset) {
  const { start, end } = periodBounds(granularity, offset)
  if (granularity === 'year') {
    return String(start.getUTCFullYear())
  }
  if (granularity === 'month') {
    return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  }
  const last = new Date(end.getTime() - 1)
  const f = (dt, withMonth) => dt.toLocaleDateString('en-US', { month: withMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC' })
  return start.getUTCMonth() === last.getUTCMonth()
    ? `${f(start, true)} – ${f(last, false)}`
    : `${f(start, true)} – ${f(last, true)}`
}

// "This week" / "Last week" / "3 weeks ago", and the month/year equivalents.
export function periodRelative(granularity, offset) {
  const unit = granularity === 'year' ? 'year' : granularity === 'month' ? 'month' : 'week'
  if (offset === 0) return `This ${unit}`
  if (offset === -1) return `Last ${unit}`
  return `${-offset} ${unit}s ago`
}
