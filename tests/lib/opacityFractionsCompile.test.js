import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// GUARD — repo-wide version of the check in ratingBands.test.js. Tailwind
// v3.4.1's JIT parser silently drops CERTAIN bare two-digit opacity
// fractions (bg-action/12) with NO build/lint/test error — the class
// compiles to nothing and the element renders with a fully transparent
// background. Reproduced against a stock `bg-red-500/12`, so it's an
// upstream parser bug, not a config problem (see CLAUDE.md "Template
// literal backticks" section's sibling note on bare opacity fractions).
//
// KNOWN_SAFE_FRACTIONS below is not "the fractions Tailwind supports" —
// it's "the exact fractions we have personally confirmed compile in THIS
// repo's build" (checked 2026-07-31 by grepping the emitted
// dist/assets/*.css after `npm run build`). Confirmed BROKEN the same way:
// /6, /8, /11, /12, /13. Extend the safe set only after the same check on
// the built CSS — never on the assumption that "it's just a number" (that
// assumption is exactly how bg-action/12 and 12 sibling instances shipped
// invisible across 7 files, #2503/#2504, caught only by this audit).
//
// Any fraction not in the safe set must use bracket syntax (bg-action/[0.12]),
// which routes through a different, unaffected parser path.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects"
// and .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
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

const FILES = walk(SRC_DIR)

// Strip `//` line comments before matching — a comment can legitimately
// quote a broken class as documentation (see the reproduction note in
// ratingBands.js: "a stock `bg-red-500/12`") without that class ever being
// emitted as real JSX. This is a line-level heuristic, not a JS parser: a
// `//` inside a string literal would falsely truncate that line, but no
// Tailwind class string in this codebase contains one.
function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

// Fractions directly confirmed to compile in this repo's Tailwind build
// (checked against the emitted CSS, 2026-07-31).
const KNOWN_SAFE_FRACTIONS = new Set([
  0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
])

// Matches the bare-fraction form (bg-action/12) but not bracket form
// (bg-action/[0.12]) or an unsuffixed base (bg-action). Covers bg-/text-/
// border-/ring-, the four utility prefixes that carry an opacity modifier
// in this codebase.
const BARE_FRACTION = /\b(?:bg|text|border|ring)-[a-zA-Z][a-zA-Z0-9_-]*\/(\d+)\b/g

describe('every bg-*/N (text-/border-/ring-) alpha class either compiles or uses bracket syntax', () => {
  it('walks a real, non-trivial file set (a rotted walker would pass vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(200)
    expect(FILES.some((f) => f.endsWith('/pages/VideoEditor.jsx'))).toBe(true)
  })

  it('finds at least one bare-fraction opacity class to check (non-vacuity)', () => {
    let count = 0
    for (const f of FILES) {
      const src = stripLineComments(readFileSync(f, 'utf8'))
      count += [...src.matchAll(BARE_FRACTION)].length
    }
    expect(count).toBeGreaterThan(50)
  })

  it('every bare fraction across src/ is a value already proven to compile', () => {
    const offenders = []
    for (const f of FILES) {
      const src = stripLineComments(readFileSync(f, 'utf8'))
      for (const match of src.matchAll(BARE_FRACTION)) {
        const n = Number(match[1])
        if (!KNOWN_SAFE_FRACTIONS.has(n)) {
          offenders.push(`${f.replace(/^.*\/src\//, 'src/')} — ${match[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
