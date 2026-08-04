import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// new URL(...).pathname percent-encodes the space in "Claude Projects" and any
// fs call on it fails ENOENT — fileURLToPath is the only safe form here.
const ROUTE = fileURLToPath(new URL('../../api/_routes/db/content.js', import.meta.url))
const raw = readFileSync(ROUTE, 'utf8')

// Scan LIVE code only. A first pass of this file asserted against the raw
// source and passed happily when the call was demoted to
// `const verdict = { ok: true } // checkPatchAgainstLock(...)` — the mutation
// that proves a source guard is hollow. Everything below runs on the
// comment-stripped text so a mention can never stand in for a call.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // the [^:] keeps https:// in string literals intact

// Guard the guard: if the stripper ever eats the whole file, every assertion
// below would pass vacuously against an empty string.
describe('the comment stripper leaves real code behind', () => {
  it('keeps the handler body', () => {
    expect(src.length).toBeGreaterThan(raw.length * 0.4)
    expect(src).toContain('export default')
  })

  it('removes commented-out code', () => {
    expect(src).not.toContain('// checkPatchAgainstLock')
  })
})

// The lock decision is pure and unit-tested (publishLock.test.js). What THIS
// pins is that the handler still calls it — the failure mode being a refactor
// that leaves the import in place while the call site drifts out of the PATCH
// path, which no unit test of the pure function could ever notice.
describe('db/content PATCH is wired to the publish lock', () => {
  it('imports the shared module rather than re-deriving the rule', () => {
    expect(src).toMatch(/import\s*\{[^}]*checkPatchAgainstLock[^}]*\}\s*from\s*'[^']*publishLock\.js'/)
  })

  // `(` required: a bare mention satisfies .includes() even inside a comment,
  // which is exactly how a hollow source guard passes forever.
  it('actually calls the check, not just mentions it', () => {
    expect(src).toContain('checkPatchAgainstLock(')
    expect(src).toContain('patchNeedsLockCheck(')
  })

  it('refuses the request when the check fails', () => {
    // 409 Conflict — the row's state, not the caller's syntax, is the problem.
    expect(src).toMatch(/verdict\.ok[\s\S]{0,400}?res\.status\(409\)/)
  })

  it('checks the stored status, never the body claim', () => {
    // curRow.status comes from the SELECT; patch.status is caller-controlled.
    expect(src).toContain('checkPatchAgainstLock(curRow.status, patch)')
    expect(src).not.toContain('checkPatchAgainstLock(patch.status')
  })

  it('reads status in the same query as media_urls, not an extra round-trip', () => {
    expect(src).toContain('select=status,media_urls')
  })
})
