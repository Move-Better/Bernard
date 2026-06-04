// Pure helpers for the Overview weekly recap. Two jobs:
//  1. Derive the "this week" recap lists (went live / scheduled / waiting /
//     captured) from the already-loaded useStories data — no extra fetch.
//  2. Turn the server's per-staff capture-week array into a consistency streak.
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

// ── "This week" recap, derived from useStories ──────────────────────────────
// Returns { stats, wentLive[], scheduled[], waiting[] }.
export function deriveWeekRecap(stories = []) {
  const now = Date.now()
  const liveByStory = new Map()
  const scheduled = []
  const waiting = []
  let wentLiveCount = 0
  let scheduledCount = 0
  let capturedCount = 0

  for (const s of stories) {
    if (within(s.created_at, WEEK_MS)) capturedCount++

    let storyInReview = false
    for (const p of s.pieces || []) {
      if (p.status === 'published' && p.published_at && now - new Date(p.published_at).getTime() <= WEEK_MS) {
        wentLiveCount++
        const e = liveByStory.get(s.id) || {
          storyId: s.id, topic: s.topic, staffName: s.staff_name,
          platforms: [], publishedAt: p.published_at, hasVideo: false,
        }
        e.platforms.push(p.platform)
        if (new Date(p.published_at) > new Date(e.publishedAt)) e.publishedAt = p.published_at
        if (p.platform === 'youtube' || p.platform === 'tiktok') e.hasVideo = true
        liveByStory.set(s.id, e)
      }
      if (p.status === 'scheduled') {
        scheduledCount++
        if (p.scheduled_at) scheduled.push({ storyId: s.id, topic: s.topic, staffName: s.staff_name, scheduledAt: p.scheduled_at })
      }
      if (p.status === 'in_review') storyInReview = true
    }
    if (storyInReview) waiting.push({ storyId: s.id, topic: s.topic, staffName: s.staff_name })
  }

  const wentLive = [...liveByStory.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
  scheduled.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))

  return {
    stats: { wentLive: wentLiveCount, scheduled: scheduledCount, waiting: waiting.length, captured: capturedCount },
    wentLive,
    scheduled,
    waiting,
  }
}
