import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// GUARD — content_items.buffer_metrics / buffer_metrics_fetched_at are DROPPED
// (migration 199). Referencing either from a PostgREST `select=` or a PATCH
// body does not throw at build, lint, or test time: PostgREST answers a select
// for a missing column with a 400 whose body nobody reads, so the feature just
// silently returns nothing. That exact failure mode kept three crons dead for
// two months on a different missing column (#2434).
//
// Per-post metrics now come from engagement_snapshots, the same table the
// daily refresh-engagement cron writes and every aggregate reader already uses.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const API_DIR = fileURLToPath(new URL('../../api', import.meta.url))
const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = [...walk(API_DIR), ...walk(SRC_DIR)]

// Match the column as a COLUMN — in a select list, a query filter, or an object
// key — not the word appearing in a comment explaining why it was removed.
// `buffer_metrics:` (object key), `buffer_metrics,` / `,buffer_metrics`
// (select list), `buffer_metrics=` (PostgREST filter).
const COLUMN_USE = /buffer_metrics(_fetched_at)?\s*[:=]|[,=]\s*buffer_metrics(_fetched_at)?\b|\bbuffer_metrics(_fetched_at)?\s*,/

describe('content_items.buffer_metrics stays dropped', () => {
  it('walks a real, non-trivial file set (a rotted walker would pass vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(200)
    // Pin the two files that used to carry the column, so an empty or
    // mis-rooted walk can't make the assertion below trivially true.
    expect(FILES.some((f) => f.endsWith('/_routes/db/content.js'))).toBe(true)
    expect(FILES.some((f) => f.endsWith('/_routes/buffer-analytics.js'))).toBe(true)
  })

  it('no handler selects, filters on, or writes the dropped columns', () => {
    const offenders = FILES.filter((f) => COLUMN_USE.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/^.*\/(api|src)\//, '$1/'))
    expect(offenders).toEqual([])
  })

  it('the per-post metrics endpoint reads engagement_snapshots instead', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../api/_routes/buffer-analytics.js', import.meta.url)),
      'utf8',
    )
    // Require the real query/insert, not just the table name in a comment.
    expect(src).toMatch(/engagement_snapshots\?content_item_id=eq\./)
    expect(src).toMatch(/writeSnapshot\(/)
  })
})
