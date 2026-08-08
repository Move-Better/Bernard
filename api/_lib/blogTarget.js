// The 1-blog-per-clinician-per-month target (Q, 2026-08-01).
//
// Pure — no I/O — so week-summary (the counter on a clinician's own strip) and
// the blog-target-nudge cron ask the SAME functions rather than each
// re-implementing the rule. A rule re-declared in two places has already drifted
// once in this repo (the Buffer/bundle publish paths); a rule re-declared in a
// TEST is worse still, because a mutation to the real one leaves it green.
//
// SHAPE NOTE — the target lives at `cadence_policy.blog_target`, deliberately a
// SIBLING of `cadence_policy.channels` and never a member of it.
// mergeSlotsIntoCadence() iterates every entry under `channels` and hands each
// one computed weekly posting slots via distributeEvenSlots(); a `blog` entry
// there would be given a weekly slot list and the Strategist would start
// planning weekly blog atoms. Blog is not a cadence-bearing atom platform (see
// #2526, which labels exactly these channels as ones the weekly planner cannot
// schedule) and this target is per-clinician-per-MONTH, which the per-channel
// per-week shape cannot express at all.

/** The practice-wide default when a workspace has not set its own. */
export const DEFAULT_BLOG_TARGET_PER_MONTH = 1

/**
 * Day of month from which a clinician who is still at zero may be nudged.
 * Deliberately late: nudging on the 3rd would tell someone they are behind on a
 * month that has barely started. Against real data every clinician reads zero
 * for most of a month, so an early nudge is an all-staff guilt email rather
 * than a signal.
 */
export const NUDGE_FROM_DAY_OF_MONTH = 24

/**
 * Resolve a workspace's blog target.
 * @param {any} workspace a workspaces row
 * @returns {{enabled: boolean, perClinicianPerMonth: number}}
 */
export function blogTargetFor(workspace) {
  const cfg = workspace?.cadence_policy?.blog_target
  // Absent config means the default target is ON. A workspace opts out with an
  // explicit `enabled: false` rather than by omission, so a tenant that never
  // touches settings still gets the practice default.
  const enabled = cfg?.enabled !== false
  const raw = Number(cfg?.per_clinician_per_month)
  const perClinicianPerMonth =
    Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BLOG_TARGET_PER_MONTH
  return { enabled, perClinicianPerMonth }
}

/**
 * The calendar month a date falls in, in the workspace's timezone, as YYYY-MM.
 *
 * Timezone matters at the boundary: a blog created 23:30 on the 31st Pacific is
 * the 1st of the next month in UTC, so a UTC-keyed counter would credit it to a
 * month the clinician had already been nudged about.
 *
 * @param {string|Date} date
 * @param {string} [timeZone]
 * @returns {string} e.g. '2026-08'
 */
export function monthKey(date, timeZone = 'America/Los_Angeles') {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  // en-CA gives ISO-ordered YYYY-MM-DD, so slicing is safe.
  const ymd = d.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return ymd.slice(0, 7)
}

/** Day-of-month in the workspace timezone. */
export function dayOfMonth(date, timeZone = 'America/Los_Angeles') {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return 0
  return Number(d.toLocaleDateString('en-CA', { timeZone, day: '2-digit' }).slice(-2))
}

/**
 * Does this blog row count toward its author's month?
 *
 * Counted on `created_at`, i.e. the month the interview produced it — that is
 * when the CLINICIAN did the part they control. Keying on published_at would
 * make a clinician's number depend on whether a producer got round to attaching
 * a hero, which is not their work and not something a nudge to them can fix.
 *
 * Rejected and archived rows do not count: a piece somebody decided against is
 * not a contribution. Everything else does, including a draft still in review —
 * the clinician has done the interview, and the target measures production, not
 * the producer's queue.
 *
 * @param {any} row a content_items row
 * @param {string} month YYYY-MM
 * @param {string} [timeZone]
 */
export function countsTowardMonth(row, month, timeZone) {
  if (!row || row.platform !== 'blog') return false
  // Archival is the archived_at timestamp, NOT a status value — 'archived' is
  // not in VALID_STATUSES (requestSchemas/dbContent.js), so a status check for
  // it can never fire. Callers' SELECTs must fetch archived_at for this to see it.
  if (row.status === 'rejected' || row.archived_at) return false
  if (!row.created_at) return false
  return monthKey(row.created_at, timeZone) === month
}

/**
 * A clinician's progress for one month.
 * @returns {{count: number, target: number, met: boolean}}
 */
export function progressFor(rows, month, target, timeZone) {
  const count = (Array.isArray(rows) ? rows : []).filter((r) => countsTowardMonth(r, month, timeZone)).length
  return { count, target, met: count >= target }
}
