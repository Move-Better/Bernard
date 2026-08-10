import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { atomSchedulePatch } from '../../api/_lib/atomSchedule.js'

// new URL(...).pathname percent-encodes the space in "Claude Projects" and any
// fs call on it fails ENOENT — fileURLToPath is the only safe form here.
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url))

// Strip comments before scanning, so a MENTION of syncAtomSchedule in prose can
// never stand in for a real call. (The whole bug this guards against is a sync
// that exists in a comment's description of the system but not in the code.)
const stripComments = (raw) => raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // the [^:] keeps https:// in string literals intact

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules') return []
    if (e.isDirectory()) return walk(`${dir}${e.name}/`)
    return e.name.endsWith('.js') ? [`${dir}${e.name}`] : []
  })
}

const FILES = walk(API_DIR).map((path) => ({
  rel: path.slice(API_DIR.length),
  src: stripComments(readFileSync(path, 'utf8')),
}))

const byRel = (rel) => FILES.find((f) => f.rel === rel)

// ── Every path that commits a schedule to content_items ──────────────────────
// /week renders from content_plan_atoms, so committing a schedule to the item
// alone leaves the board showing the post on its original planned day. Each of
// these must call the shared helper — not re-implement the mirror, which is how
// the copies drift apart (the mirror-pair class in CLAUDE.md).
//
// The value is the number of schedule-commit sites in that file, so losing ONE
// of several still reddens. A file-level "does it call the helper at all" check
// does NOT catch that: mutation-testing this guard, deleting the success-path
// sync in dispatchContentItem.js (the one that actually posts) left the test
// green, because its other call site still satisfied a presence match.
//
// Adding a commit site? Bump the count here in the same change — that is the
// point, not an inconvenience.
const MUST_SYNC = {
  '_routes/publish/social.js': 1,        // editor Publish/Schedule
  '_lib/dispatchContentItem.js': 2,      // /week Approve: already-dispatched + all-posted
  '_routes/producer/retry-publish.js': 1,// manual Retry (scheduled branch only)
  '_routes/db/content.js': 1,            // editor (re)schedule + unschedule
}

// Files that write status:'scheduled' but deliberately do NOT sync, each with
// the reason. Listed so a future reader has to make the same decision
// consciously rather than by omission.
const DOCUMENTED_EXCLUSIONS = {
  // Commits status + platform_post_id but NO scheduled_at: the cron fires at the
  // already-planned time, so the atom's slot is already correct. Nothing to mirror.
  '_routes/cron/auto-publish.js': 'commits no scheduled_at',
  // `{ status: 'scheduled' }` here is the HTTP response body, not a DB write.
  '_routes/content-plan/approve.js': 'response body, not a row write',
}

describe('the comment stripper leaves real code behind', () => {
  // Without this, every source assertion below could pass against an empty string.
  it('keeps code and drops commented-out calls', () => {
    const social = byRel('_routes/publish/social.js')
    expect(social.src).toContain('export async function runBundlePublish')
    expect(stripComments('// syncAtomSchedule({ a: 1 })')).not.toContain('syncAtomSchedule')
  })
})

describe('every path that commits a schedule mirrors it onto the plan atom', () => {
  it.each(Object.entries(MUST_SYNC))('%s syncs at every commit site (%i)', (rel, expected) => {
    const file = byRel(rel)
    expect(file, `${rel} not found — did it move?`).toBeTruthy()
    // `syncAtomSchedule(` — an actual call. A bare name match would be satisfied
    // by the import line alone, which is exactly the inert-wiring failure.
    const calls = file.src.match(/syncAtomSchedule\(/g) || []
    expect(
      calls.length,
      `${rel} has ${calls.length} syncAtomSchedule() calls, expected ${expected}. ` +
      'If you added or removed a schedule-commit site, update MUST_SYNC to match.',
    ).toBe(expected)
    expect(file.src).toMatch(/import\s*\{[^}]*syncAtomSchedule[^}]*\}\s*from\s*'[^']*atomSchedule\.js'/)
  })

  it('nobody re-implements the mirror inline instead of calling the helper', () => {
    // A second copy of the plan_week recompute is the drift this exists to stop.
    const offenders = FILES
      .filter((f) => f.rel !== '_lib/atomSchedule.js')
      .filter((f) => /content_plan_atoms\?content_piece_id=/.test(f.src) && /plan_week:/.test(f.src))
      .map((f) => f.rel)
    expect(offenders).toEqual([])
  })
})

describe('the MUST_SYNC list is complete', () => {
  // Discovery: anything committing a terminal 'scheduled' status. A new publish
  // path fails here until it is consciously placed in one bucket or the other.
  const committers = FILES
    .filter((f) => /status:\s*'scheduled'/.test(f.src))
    .map((f) => f.rel)

  it('finds the known committers (non-vacuity — a rotted regex must not pass)', () => {
    expect(committers).toContain('_routes/publish/social.js')
    expect(committers).toContain('_lib/dispatchContentItem.js')
    expect(committers).toContain('_routes/cron/auto-publish.js')
    expect(committers.length).toBeGreaterThanOrEqual(3)
  })

  it('leaves no committer unaccounted for', () => {
    const accounted = new Set([...Object.keys(MUST_SYNC), ...Object.keys(DOCUMENTED_EXCLUSIONS)])
    expect(committers.filter((rel) => !accounted.has(rel))).toEqual([])
  })

  it('pins auto-publish as an exclusion BECAUSE it commits no scheduled_at', () => {
    // If it ever starts committing one, it stops being a valid exclusion.
    const src = byRel('_routes/cron/auto-publish.js').src
    expect(src).not.toMatch(/scheduled_at:/)
  })
})

// ── The pure patch ───────────────────────────────────────────────────────────
// 2026-08-10 is a Monday; Tue = 08-11, Wed = 08-12, Sun = 08-16, next Mon = 08-17.
const PT = 'America/Los_Angeles'
const NOW = '2026-08-10T17:00:00.000Z'

describe('atomSchedulePatch', () => {
  it('carries the committed schedule through unchanged', () => {
    const at = '2026-08-11T16:00:00.000Z'
    expect(atomSchedulePatch(at, PT, NOW).scheduled_at).toBe(at)
  })

  it('recomputes plan_week from the schedule, so a move across weeks re-buckets', () => {
    expect(atomSchedulePatch('2026-08-12T15:00:00.000Z', PT, NOW).plan_week).toBe('2026-08-10')
    expect(atomSchedulePatch('2026-08-19T15:00:00.000Z', PT, NOW).plan_week).toBe('2026-08-17')
  })

  it('buckets by the workspace timezone, not UTC', () => {
    // 05:00Z Monday is still Sunday 22:00 in PT — it belongs to the PREVIOUS week.
    const at = '2026-08-17T05:00:00.000Z'
    expect(atomSchedulePatch(at, PT, NOW).plan_week).toBe('2026-08-10')
    expect(atomSchedulePatch(at, undefined, NOW).plan_week).toBe('2026-08-17')
  })

  it('clears held_at on a real schedule — a placed piece is no longer backlog', () => {
    expect(atomSchedulePatch('2026-08-11T16:00:00.000Z', PT, NOW).held_at).toBeNull()
  })

  it('on unschedule, returns the atom to the CURRENT week and leaves held_at alone', () => {
    const out = atomSchedulePatch(null, PT, NOW)
    expect(out.scheduled_at).toBeNull()
    expect(out.plan_week).toBe('2026-08-10')
    expect(out).not.toHaveProperty('held_at')
  })
})
