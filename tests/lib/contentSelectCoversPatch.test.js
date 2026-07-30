import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — a column you can WRITE must also be a column you can READ.
//
// api/_routes/db/content.js has two independent lists: the PATCH allowlist
// (camelCase → snake_case) and the SELECT string. Adding to one and not the
// other produces a write-only column: the PATCH succeeds, the row updates, and
// every reader gets undefined. Nothing errors — the feature is just inert.
//
// That is exactly how `format` shipped in #2467. The picker wrote
// content_items.format correctly, but SELECT omitted it, so the control never
// showed its own selection, the badge never changed, and publishPiece's
// `piece.format` was undefined — meaning the explicit format never reached the
// publish payload either. Caught only by driving the real authed page in prod;
// lint, typecheck, build, 902 unit tests and route-smoke were all green.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const SRC = readFileSync(
  fileURLToPath(new URL('../../api/_routes/db/content.js', import.meta.url)),
  'utf8',
)

// snake_case column names the PATCH allowlist maps to. Parsed from the
// `const allowed = { … }` block: lines of the form `column_name: patch.foo`.
function patchColumns(src) {
  const start = src.indexOf('const allowed = {')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('\n    }', start))
  return [...block.matchAll(/^\s{6}([a-z_0-9]+):/gm)].map((m) => m[1])
}

function selectColumns(src) {
  const m = src.match(/^const SELECT = '([^']+)'/m)
  expect(m).toBeTruthy()
  return m[1].split(',').map((s) => s.trim())
}

// Columns a client may WRITE but that are deliberately not read back through
// this route. Keep empty unless there's a real reason, and state it.
const WRITE_ONLY_BY_DESIGN = new Set([
  // Audit/bookkeeping the client sets but reads elsewhere (or never).
  'updated_at',
])

describe('db/content: every PATCHable column is also SELECTable', () => {
  const patch = patchColumns(SRC)
  const select = new Set(selectColumns(SRC))

  it('parses both lists (a rotted regex would pass vacuously)', () => {
    expect(patch.length).toBeGreaterThan(10)
    expect(select.size).toBeGreaterThan(10)
    // Pin known members so an empty/garbage parse can't slip through.
    expect(patch).toContain('media_urls')
    expect(select.has('media_urls')).toBe(true)
  })

  it('has no write-only columns', () => {
    const writeOnly = patch.filter((c) => !select.has(c) && !WRITE_ONLY_BY_DESIGN.has(c))
    expect(writeOnly).toEqual([])
  })

  it('specifically covers format + format_source (the #2467 regression)', () => {
    expect(select.has('format')).toBe(true)
    expect(select.has('format_source')).toBe(true)
  })
})
