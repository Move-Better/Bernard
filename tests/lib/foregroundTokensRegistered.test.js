import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import tailwindConfig from '../../tailwind.config.js'

// GUARD — a class like `text-success-foreground` only compiles if
// tailwind.config.js registers `success` as a color GROUP with a
// `foreground` sub-key ({ DEFAULT, foreground }), not as a flat color
// string. Tailwind gives no error either way -- an unregistered utility
// class simply emits no CSS, same failure shape as the bare-opacity-
// fraction bug in opacityFractionsCompile.test.js, and the same shape as
// the documented bg-popover gotcha in CLAUDE.md ("confirm the token has a
// matching entry in theme.extend.colors — grep the config, don't assume a
// var's existence means the utility class works").
//
// Found live 2026-07-31: `success` and `warning` were both flat strings
// (matching --success/--warning existing as real CSS custom properties in
// index.css, which made the class LOOK like it should work) while
// `text-success-foreground`/`text-warning-foreground` were already used in
// 10+ real components — including the widely-shared ConnectedBadge and
// live status pills on /week — silently rendering with no color override
// at all. Confirmed against the actual compiled dist/assets/*.css both
// ways (missing before the config fix, present after).
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

function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

// Matches `text-`/`bg-`/`border-`(+optional directional t/r/b/l/x/y)/`ring-`
// classes ending in `-foreground`, e.g. text-success-foreground,
// border-l-muted-foreground. Excludes the base `foreground`/`*-foreground`
// tokens that are already top-level color keys (text-foreground,
// text-card-foreground) -- those are legitimately flat.
const FOREGROUND_CLASS = /\b(?:bg|text|border(?:-[ltrbxy])?|ring)-([a-z][a-z0-9-]*)-foreground\b/g

const KNOWN_FLAT_FOREGROUND_TOKENS = new Set([
  // top-level `foreground` and existing `<x>-foreground` color GROUP keys
  // (card, popover, muted, accent, secondary, primary, destructive,
  // sidebar) are legitimate as-is -- this set exists only so the regex
  // above (which strips one trailing `-foreground` layer) doesn't
  // misparse a token that already contains a real hyphenated group name.
  'card', 'popover', 'muted', 'accent', 'secondary', 'primary', 'destructive', 'sidebar', 'sidebar-active',
])

describe('every used *-foreground Tailwind class has a matching color group in tailwind.config.js', () => {
  const colors = tailwindConfig.theme.extend.colors

  it('walks a real, non-trivial file set (a rotted walker would pass vacuously)', () => {
    expect(FILES.length).toBeGreaterThan(200)
  })

  it('finds real *-foreground usages to check (non-vacuity)', () => {
    let count = 0
    for (const f of FILES) {
      const src = stripLineComments(readFileSync(f, 'utf8'))
      count += [...src.matchAll(FOREGROUND_CLASS)].length
    }
    expect(count).toBeGreaterThan(5)
  })

  it('every base token used with -foreground is registered with a `foreground` sub-key', () => {
    const offenders = []
    for (const f of FILES) {
      const src = stripLineComments(readFileSync(f, 'utf8'))
      for (const match of src.matchAll(FOREGROUND_CLASS)) {
        const token = match[1]
        if (KNOWN_FLAT_FOREGROUND_TOKENS.has(token)) continue
        const entry = colors[token]
        const hasForeground = entry && typeof entry === 'object' && 'foreground' in entry
        if (!hasForeground) {
          offenders.push(`${f.replace(/^.*\/src\//, 'src/')} — ${match[0]} (config has: ${JSON.stringify(entry)})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
