import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OUTPUT_PLATFORM_MAP } from '../../api/_lib/interviewOutputFanout.js'

// Migration 209 closes the fan-out duplicate-row race with a PARTIAL unique
// index on (interview_id, platform). Its predicate hard-codes the six fan-out
// platforms, because the content-plan platforms legitimately hold many rows per
// interview (measured before writing it: instagram 15 groups, linkedin 11,
// facebook 7, gbp 6 — a blanket index could not even have been built).
//
// That makes the index a second copy of OUTPUT_PLATFORM_MAP, and this repo has
// been bitten repeatedly by two lists that must agree and silently stop
// agreeing (the PATCH-allowlist-vs-SELECT trap in db/content.js is the same
// shape). The failure here is quiet in BOTH directions:
//   • a platform added to the map but not the index → the race stays open for
//     that platform, and nothing reports it;
//   • a platform in the index but not the map → an unrelated producer's second
//     row for that interview is rejected 23505 at insert time, in prod.
// So the two lists get pinned to each other rather than to a comment.
//
// `fileURLToPath` (not .pathname) because every path here contains a space —
// "Claude Projects" — which .pathname percent-encodes into an ENOENT.

const MIGRATION = fileURLToPath(
  new URL('../../supabase/multitenant/migrations/209_content_items_fanout_unique.sql', import.meta.url),
)

/** Pull the platform list out of the index's `platform in (...)` predicate. */
function platformsInIndexPredicate(sql) {
  // Only the CREATE INDEX statement — the file's header comment also names
  // these platforms, and matching prose would let a stale comment satisfy the
  // test while the real predicate drifted.
  const stmt = sql.slice(sql.search(/create\s+unique\s+index/i))
  const m = stmt.match(/platform\s+in\s*\(([^)]*)\)/i)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
}

describe('migration 209 fan-out unique index', () => {
  const sql = readFileSync(MIGRATION, 'utf8')
  const indexed = platformsInIndexPredicate(sql)
  const mapped = OUTPUT_PLATFORM_MAP.map((e) => e.platform)

  it('parses a real platform list out of the index predicate (non-vacuity)', () => {
    // Without this, a rotted regex returning [] would make the equality below
    // pass trivially against an empty map and guard nothing.
    expect(indexed.length).toBeGreaterThan(0)
    expect(mapped.length).toBeGreaterThan(0)
    expect(indexed).toContain('blog')
  })

  it('covers exactly the platforms the fan-out inserts', () => {
    expect([...indexed].sort()).toEqual([...mapped].sort())
  })

  it('excludes the content-plan platforms, which legitimately repeat per interview', () => {
    // These come from content_plan_atoms, never the fan-out. Including any of
    // them would reject the planner's second post for an interview.
    for (const p of ['instagram', 'facebook', 'linkedin', 'gbp', 'tiktok']) {
      expect(indexed).not.toContain(p)
    }
  })

  it('keeps the series_id predicate that lets split-into-series write its parts', () => {
    // split-into-series inserts N blog rows sharing one interview_id, each with
    // a non-null series_id. Dropping this predicate breaks that feature outright.
    const stmt = sql.slice(sql.search(/create\s+unique\s+index/i))
    expect(stmt).toMatch(/series_id\s+is\s+null/i)
  })
})
