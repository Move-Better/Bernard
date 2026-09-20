// Week/timezone math for the /week board.
//
// Extracted from YourWeek.jsx so it can be tested. This is a client/server
// MIRROR PAIR: weekMondayDate(0, tz) must agree with the server's
// mondayOf(new Date(), tz) in api/_lib/strategist.js, and NAV_BACK/NAV_FWD must
// match the bounds in week-summary.js + plan-week.js. Change one side, change
// the other — tests/lib/weekDates.test.js pins the agreement.
//
// One deliberate difference from the original: weekMondayDate and
// weekOffsetForDate take an optional `now` (defaulting to `new Date()`), so the
// week rollover can be tested at a chosen instant. Every existing call site
// passes two arguments, so behaviour is unchanged.

// Week navigation (F2): page back through finished weeks (read-only, up to 8) or
// forward to plan ahead (up to 4). Must mirror the server's bounds in week-summary.js
// + plan-week.js.
export const NAV_BACK = 8
export const NAV_FWD = 4

// The workspace-tz Monday for an offset from the current week, returned as a Date
// anchored at UTC-midnight of that Monday (so callers can read getUTCDate() /
// toISOString() off it and format in UTC). Mirrors the server's mondayOf(now, tz)
// EXACTLY: derive the workspace-LOCAL calendar date for "now" first, THEN take its
// ISO-Monday — so the week flips at local midnight, not UTC midnight. Pre-fix this
// used getUTCDay() on `new Date()`, so a Pacific workspace jumped to next week from
// ~5pm Sunday local (once UTC had ticked over to Monday), hiding the running week's
// earlier posts and labeling the board a day early. `tz` is IANA.
export function localYMD(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const part = (t) => Number(parts.find((p) => p.type === t).value)
  return [part('year'), part('month'), part('day')]
}

export function weekMondayDate(offset, tz, now = new Date()) {
  const [y, m, d] = localYMD(now, tz || 'America/Los_Angeles')
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  const dow = (anchor.getUTCDay() + 6) % 7 // 0 = Monday
  anchor.setUTCDate(anchor.getUTCDate() - dow + offset * 7)
  anchor.setUTCHours(0, 0, 0, 0)
  return anchor
}

export function weekMondayISO(offset, tz, now = new Date()) {
  return weekMondayDate(offset, tz, now).toISOString().slice(0, 10)
}

// T3 — Month overview: convert a clicked calendar date into the weekOffset
// units Week view already navigates by (weeks from the current week).
export function weekOffsetForDate(dateISO, tz, now = new Date()) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const targetMonday = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  const dow = (targetMonday.getUTCDay() + 6) % 7
  targetMonday.setUTCDate(targetMonday.getUTCDate() - dow)
  const thisMonday = weekMondayDate(0, tz, now)
  return Math.round((targetMonday.getTime() - thisMonday.getTime()) / (7 * 86_400_000))
}

export function weekRangeLabel(offset, tz, now = new Date()) {
  const mon = weekMondayDate(offset, tz, now)
  const sun = new Date(mon)
  sun.setUTCDate(sun.getUTCDate() + 6)
  const f = (dt, withMonth) => dt.toLocaleDateString('en-US', { month: withMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC' })
  return mon.getUTCMonth() === sun.getUTCMonth()
    ? `${f(mon, true)} – ${f(sun, false)}`
    : `${f(mon, true)} – ${f(sun, true)}`
}

export function weekRelative(offset) {
  if (offset === 0) return 'This week'
  if (offset === 1) return 'Next week'
  if (offset === -1) return 'Last week'
  return offset > 0 ? `In ${offset} weeks` : `${-offset} weeks ago`
}

// Friendly zone label so the cadence footer reads "Pacific time", not the raw
// IANA city ("Los Angeles times" — which also read like the newspaper).
export const TZ_LABELS = {
  'America/Los_Angeles': 'Pacific time',
  'America/Tijuana': 'Pacific time',
  'America/Denver': 'Mountain time',
  'America/Phoenix': 'Mountain time',
  'America/Chicago': 'Central time',
  'America/New_York': 'Eastern time',
  'America/Anchorage': 'Alaska time',
  'Pacific/Honolulu': 'Hawaii time',
}

export function tzLabel(tz) {
  if (!tz) return 'local time'
  return TZ_LABELS[tz] || `${tz.split('/').pop().replace(/_/g, ' ')} time`
}

export function timeLabel(iso, tz) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: tz || undefined,
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
