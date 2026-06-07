#!/usr/bin/env node
// One-time migration for the function-consolidation plan.
// Moves every non-kept api/<rel>.js handler to api/_routes/<rel>.js (so Vercel
// stops building it as its own function — the `_` prefix is ignored by function
// detection) and rewrites relative import specifiers in EVERY api file (moved or
// kept) so they keep resolving after the +1 depth change.
//
// Move-aware: for each relative import, the target's NEW location is computed
// (if the target itself moved, point at its new path; otherwise keep it and
// re-relativize from the mover's new, deeper location). This handles _lib (stays
// put → gets an extra ../), ../../src (stays put → deeper), siblings (move
// together → unchanged), and cross-tree imports (e.g. a kept cron importing a
// migrated editorial helper → rewritten in place).
//
// Default is DRY-RUN. Pass --apply to execute (git mv + rewrite).
//
//   node scripts/migrate-api-to-routes.mjs            # dry run
//   node scripts/migrate-api-to-routes.mjs --apply    # do it

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { isKept } from './api-consolidation.config.mjs'

const APPLY = process.argv.includes('--apply')
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const API = join(ROOT, 'api')
const ROUTES = join(API, '_routes')

const toPosix = (p) => p.split(sep).join('/')

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (full === join(API, '_lib') || full === ROUTES) continue
      walk(full, acc)
    } else if (name.endsWith('.js')) {
      acc.push(full)
    }
  }
  return acc
}

// All api handler files (excluding _lib and any pre-existing _routes).
const allFiles = walk(API)

// Build the MOVE map: oldAbs -> newAbs for everything not kept.
const move = new Map()
for (const abs of allFiles) {
  const rel = toPosix(relative(API, abs))
  if (isKept(rel)) continue
  move.set(abs, join(ROUTES, rel))
}

// Resolve an import target to an absolute file path (best-effort, ESM uses .js).
function resolveTarget(fromDir, spec) {
  let abs = resolve(fromDir, spec)
  if (!abs.endsWith('.js')) {
    // try `${abs}.js` then `${abs}/index.js`
    abs = abs + '.js'
  }
  return abs
}

const RE = /(\bfrom\s+|\bimport\s*\(\s*)(['"])(\.[^'"]+)\2/g

function rewriteImports(content, oldAbs, newAbs) {
  const oldDir = dirname(oldAbs)
  const newDir = dirname(newAbs)
  let count = 0
  const out = content.replace(RE, (full, kw, q, spec) => {
    const targetOld = resolveTarget(oldDir, spec)
    const targetNew = move.get(targetOld) || targetOld
    let rerel = toPosix(relative(newDir, targetNew))
    if (!rerel.startsWith('.')) rerel = './' + rerel
    if (rerel !== spec) count++
    return `${kw}${q}${rerel}${q}`
  })
  return { out, count }
}

let moved = 0
let keptRewritten = 0
let specs = 0
const plan = []

for (const oldAbs of allFiles) {
  const isMoving = move.has(oldAbs)
  const newAbs = isMoving ? move.get(oldAbs) : oldAbs
  const content = readFileSync(oldAbs, 'utf8')
  const { out, count } = rewriteImports(content, oldAbs, newAbs)
  specs += count
  if (isMoving) {
    moved++
    plan.push({ from: toPosix(relative(ROOT, oldAbs)), to: toPosix(relative(ROOT, newAbs)), rewrites: count })
    if (APPLY) {
      mkdirSync(dirname(newAbs), { recursive: true })
      execSync(`git mv ${JSON.stringify(toPosix(relative(ROOT, oldAbs)))} ${JSON.stringify(toPosix(relative(ROOT, newAbs)))}`, { cwd: ROOT })
      writeFileSync(newAbs, out)
    }
  } else if (count > 0) {
    keptRewritten++
    plan.push({ from: toPosix(relative(ROOT, oldAbs)), to: '(in place)', rewrites: count })
    if (APPLY) writeFileSync(oldAbs, out)
  }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — move-aware api consolidation`)
console.log(`  files to move:        ${moved}`)
console.log(`  kept files rewritten: ${keptRewritten}`)
console.log(`  import specs rewritten: ${specs}`)
console.log('')
for (const p of plan.slice(0, APPLY ? 0 : 9999)) {
  console.log(`  ${p.from}  →  ${p.to}${p.rewrites ? `  (${p.rewrites} import${p.rewrites > 1 ? 's' : ''})` : ''}`)
}
if (!APPLY) console.log('\n(dry run — re-run with --apply to execute)')
