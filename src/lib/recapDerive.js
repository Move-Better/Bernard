// Pure helpers for the Overview weekly recap. Three jobs:
//  1. Derive the "Right now" queues (scheduled next / waiting on review) from
//     the already-loaded useStories data — current-state, so no extra fetch.
//  2. Turn the server's per-staff capture-week array into a consistency streak.
//  3. Label math for the calendar-week navigator (range strings, relative
//     labels, the how-far-back floor). Week facts themselves come from the
//     workspace_week_recap RPC — the client no longer recomputes them.
// Kept pure (no React) so the logic is trivially testable.

import { PLATFORM_META } from '@/lib/contentMeta'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DUE_AFTER_MS = 21 * 24 * 60 * 60 * 1000 // 3 weeks quiet → gentle nudge

function within(iso, ms) {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() <= ms
}

export function platformLabels(platforms) {
  const seen = []
  for (const p of platforms) {
    const label = PLATFORM_META[p]?.label?.replace(' Post', '') ?? p
    if (label && !seen.includes(label)) seen.push(label)
  }
  return seen
}

// UTC Monday 00:00 of the week containing `d` — matches Postgres
// date_trunc('week', …) under the default UTC session.
function mondayOf(d) {
  const x = new Date(d)
  const dow = (x.getUTCDay() + 6) % 7 // 0 = Monday
  x.setUTCDate(x.getUTCDate() - dow)
  x.setUTCHours(0, 0, 0, 0)
  return x
}
const isoDay = (d) => d.toISOString().slice(0, 10)

// Consecutive-week capture streak. `weeks` is an array of 'YYYY-MM-DD' week
// starts. The current week is allowed to be still in progress (not yet
// captured) without breaking the streak — we start counting from last week
// in that case.
export function computeStreak(weeks) {
  if (!Array.isArray(weeks) || weeks.length === 0) return 0
  const set = new Set(weeks)
  let cursor = mondayOf(new Date())
  if (!set.has(isoDay(cursor))) cursor = new Date(cursor.getTime() - WEEK_MS)
  let streak = 0
  while (set.has(isoDay(cursor))) {
    streak++
    cursor = new Date(cursor.getTime() - WEEK_MS)
  }
  return streak
}

// Classify a team member for the cadence card.
//   'active'  — captured within the last week
//   'steady'  — has history, captured within 3 weeks
//   'due'     — has history but quiet 3+ weeks
//   'new'     — never captured
export function classifyMember(m) {
  if (!m.last_capture_at && !(m.all_time_published > 0)) return 'new'
  if (within(m.last_capture_at, WEEK_MS)) return 'active'
  if (within(m.last_capture_at, DUE_AFTER_MS)) return 'steady'
  return 'due'
}

// Sort: most-recently-active first; never-captured last.
export function sortTeam(team = []) {
  return [...team].sort((a, b) => {
    const ta = a.last_capture_at ? new Date(a.last_capture_at).getTime() : -1
    const tb = b.last_capture_at ? new Date(b.last_capture_at).getTime() : -1
    if (tb !== ta) return tb - ta
    return (b.all_time_published || 0) - (a.all_time_published || 0)
  })
}

// ── "Right now" queues, derived from useStories ─────────────────────────────
// Scheduled-next + waiting-on-review. These describe the present (queues), not
// a historical week, so they live outside the week navigator. The historical
// week facts (published / captured / drafted) come from the server's
// workspace_week_recap RPC — the old client-side derivation double-counted
// against a capped cache and disagreed with the SQL team pills on screen.
export function deriveNowQueues(stories = []) {
  const scheduled = []
  const waiting = []
  for (const s of stories) {
    let storyInReview = false
    for (const p of s.pieces || []) {
      if (p.status === 'scheduled' && p.scheduled_at) {
        scheduled.push({ storyId: s.id, topic: s.topic, staffName: s.staff_name, scheduledAt: p.scheduled_at })
      }
      if (p.status === 'in_review') storyInReview = true
    }
    if (storyInReview) waiting.push({ storyId: s.id, topic: s.topic, staffName: s.staff_name })
  }
  scheduled.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
  return { scheduled, waiting }
}

// ── Week-navigator label math ────────────────────────────────────────────────
// "Jul 13 – 19" from the RPC's week_start/week_end date strings (end
// exclusive), UTC — mirrors periodMath.js's label shape so Overview and
// Insights read the same way.
export function fmtWeekRange(weekStart, weekEnd) {
  if (!weekStart || !weekEnd) return ''
  const start = new Date(`${weekStart}T00:00:00Z`)
  const last = new Date(new Date(`${weekEnd}T00:00:00Z`).getTime() - 1)
  const f = (dt, withMonth) =>
    dt.toLocaleDateString('en-US', { month: withMonth ? 'short' : undefined, day: 'numeric', timeZone: 'UTC' })
  return start.getUTCMonth() === last.getUTCMonth()
    ? `${f(start, true)} – ${f(last, false)}`
    : `${f(start, true)} – ${f(last, true)}`
}

export function weekRelative(offset) {
  if (offset === 0) return 'This week'
  if (offset === -1) return 'Last week'
  return `${-offset} weeks ago`
}

// How far back Prev may go: the offset of the workspace's first-activity week
// (workspace_recap's first_week, a 'YYYY-MM-DD' Monday). 0 when unknown, so an
// empty workspace simply can't navigate.
export function floorWeekOffset(firstWeek) {
  if (!firstWeek) return 0
  const first = new Date(`${firstWeek}T00:00:00Z`).getTime()
  const cur = mondayOf(new Date()).getTime()
  return Math.min(0, Math.round((first - cur) / WEEK_MS))
}
