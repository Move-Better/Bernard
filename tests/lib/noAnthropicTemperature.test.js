// Anthropic API version 2026-10-21 returns 400 when a request carries
// `temperature` (or top_p / top_k), on every Claude model. Bernard reaches
// Claude through the Vercel AI Gateway, so the day the Gateway moves to that
// version every call that still sends `temperature` fails at once: captions,
// moments, voice audit, onboarding. Deep Thought hit exactly this 400 on
// 2026-11-12. Bernard dropped `temperature` from its Anthropic calls on
// 2026-11-19 (Gateway probe that day: still accepted on Sonnet 4.6 and
// Haiku 4.5, so the removal is ahead of the break, not after it).
//
// This guard scans every source file under api/, src/ and scripts/. For each
// object literal that holds `temperature:` / `topP:` / `topK:` next to a
// `model:` key, it resolves the model (a string literal, or a same-file
// `const NAME = '...'`) and fails when it is an `anthropic/` model. A model it
// cannot resolve also fails, unless the site is in REVIEWED_DYNAMIC below with
// a reason, so a new call site cannot slip past by using a variable.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIRS = ['api', 'src', 'scripts']
const EXT = /\.(m?js|jsx|ts|tsx)$/
const SAMPLING_KEY = /\b(temperature|topP|topK|top_p|top_k)\s*:/g

// Sites whose model comes from a parameter. Each was checked by hand.
const REVIEWED_DYNAMIC = {
  // `model` defaults to DEFAULT_VIDEO_MODEL (google/gemini-*); its only caller,
  // scoreMomentsVisual.js, passes that same default. A video-window call needs
  // a video model, never a Claude one.
  'api/_lib/analyzeVideoWindow.js': 'model',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(name)) out.push(p)
  }
  return out
}

// Index of the `{` that opens the object literal containing position i.
function enclosingOpen(src, i) {
  let depth = 0
  for (let j = i; j >= 0; j--) {
    const c = src[j]
    if (c === '}') depth++
    else if (c === '{') {
      if (depth === 0) return j
      depth--
    }
  }
  return -1
}

function matchingClose(src, open) {
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return j
  }
  return src.length
}

// The `model:` value at the top level of the object body (nested objects skipped).
function topLevelModel(body) {
  let depth = 0
  for (let j = 0; j < body.length; j++) {
    const c = body[j]
    if (c === '{' || c === '[' || c === '(') depth++
    else if (c === '}' || c === ']' || c === ')') depth--
    else if (depth === 0 && body.startsWith('model', j) && !/[\w$]/.test(body[j - 1] || '') && !/[\w$]/.test(body[j + 5] || '')) {
      const m = body.slice(j).match(/^model\s*(?::\s*([^,\n}]+))?/)
      if (m) return (m[1] ?? 'model').trim()   // `model,` shorthand → identifier `model`
    }
  }
  return null
}

// A string literal, a same-file const, or a const imported by name from a
// relative module (one hop).
function resolveModel(expr, src, file) {
  const lit = expr.match(/^['"`]([^'"`]+)['"`]$/)
  if (lit) return lit[1]
  if (!/^[A-Za-z_$][\w$]*$/.test(expr)) return null
  const decl = src.match(new RegExp(`(?:const|let|var)\\s+${expr}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`))
  if (decl) return decl[1]
  const imp = src.match(new RegExp(`import\\s*\\{[^}]*\\b${expr}\\b[^}]*\\}\\s*from\\s*['"](\\.[^'"]+)['"]`))
  if (imp && file) {
    try {
      const other = readFileSync(join(dirname(file), imp[1]), 'utf8')
      return resolveModel(expr, other, null)
    } catch { return null }
  }
  return null
}

function findViolations() {
  const violations = []
  for (const dir of DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8')
      const rel = relative(ROOT, file)
      for (const hit of src.matchAll(SAMPLING_KEY)) {
        const open = enclosingOpen(src, hit.index)
        if (open < 0) continue
        const body = src.slice(open + 1, matchingClose(src, open))
        const expr = topLevelModel(body)
        if (!expr) continue   // not a model call (e.g. a config object)
        const line = src.slice(0, hit.index).split('\n').length
        const model = resolveModel(expr, src, file)
        if (model === null) {
          if (REVIEWED_DYNAMIC[rel] === expr) continue
          violations.push(`${rel}:${line} sends ${hit[1]} with an unresolved model (${expr}); use a literal/const model or review it into REVIEWED_DYNAMIC`)
        } else if (model.startsWith('anthropic/')) {
          violations.push(`${rel}:${line} sends ${hit[1]} to ${model}`)
        }
      }
    }
  }
  return violations
}

describe('no Anthropic-routed call sends temperature / topP / topK', () => {
  it('finds no violations', () => {
    expect(findViolations()).toEqual([])
  })

  it('still sees the Gemini calls that legitimately send temperature (scanner is not blind)', () => {
    const src = readFileSync(join(ROOT, 'api/_lib/tagAsset.js'), 'utf8')
    const hit = [...src.matchAll(SAMPLING_KEY)][0]
    expect(hit).toBeTruthy()
    const open = enclosingOpen(src, hit.index)
    const expr = topLevelModel(src.slice(open + 1, matchingClose(src, open)))
    expect(resolveModel(expr, src, null)).toMatch(/^google\//)
  })
})
