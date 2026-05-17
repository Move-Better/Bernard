#!/usr/bin/env node
// Smoke-tests every Node-runtime API handler by attempting a dynamic import
// of its source file from the project root. Catches ERR_INTERNAL_ASSERTION
// and similar load-time crashes (e.g. an ESM-only sub-package being loaded
// via require, or a static import of a name that the target module does not
// export) before they reach production.
//
// Why this works without `vercel build`: Vercel's Node runtime copies source
// files into each .func bundle unchanged and traces node_modules into the
// bundle. The crash class we care about (sharp / jimp / native-module ESM-CJS
// mismatch) fires during Node's module loading, which is identical whether
// the file resolves dependencies from a per-function node_modules or from the
// project's own node_modules. So importing each api/**/*.js from the project
// root with the project's installed dependencies reproduces the exact module
// graph that breaks in production.
//
// What this DOES NOT cover:
//   - Bundle-time transforms (Vercel does not transform Node source — they're
//     copied verbatim — so there are none to test).
//   - Runtime invocation behavior (we never call the handler; we only load it).
//
// Usage:
//   node scripts/verify-function-bundles.mjs [--verbose]

import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VERBOSE = process.argv.includes('--verbose')
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const API_DIR = join(ROOT, 'api')

// Handlers that cannot be import-tested in isolation. Each entry must include
// an inline comment explaining why. Keep this list as short as possible —
// every entry is a blindspot for the ERR_INTERNAL_ASSERTION class of crashes.
const ALLOWLIST = new Set([
  // (currently empty — add entries here only when a handler provably requires
  // a runtime env var to be present before its module graph can be loaded,
  // not merely because it uses an env var at call time)
])

const CONCURRENCY = 10
const IMPORT_TIMEOUT_MS = 15_000

// ─── helpers ─────────────────────────────────────────────────────────────────

async function findHandlerFiles(dir) {
  const results = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      // _lib is internal helpers, not a deployed handler surface.
      if (e.name === '_lib') continue
      results.push(...await findHandlerFiles(full))
    } else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs'))) {
      results.push(full)
    }
  }
  return results
}

function importInChild(filePath) {
  return new Promise((resolve) => {
    const url = pathToFileURL(filePath).href
    const script =
      `import(${JSON.stringify(url)})` +
      `.then(()=>process.exit(0))` +
      `.catch(e=>{process.stderr.write((e.code?e.code+': ':'')+e.message+'\\n');process.exit(1)})`

    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, stderr: 'timed out after 15s' })
    }, IMPORT_TIMEOUT_MS)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stderr: stderr.trim() })
    })
  })
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await stat(API_DIR)
  } catch {
    console.error(`ERROR: ${API_DIR} not found.`)
    process.exit(2)
  }

  const files = await findHandlerFiles(API_DIR)
  const tasks = []

  for (const file of files) {
    const key = relative(ROOT, file)
    if (ALLOWLIST.has(key)) {
      if (VERBOSE) console.log(`  skip  ${key}  (allowlisted)`)
      continue
    }
    tasks.push({ file, key })
  }

  console.log(`Smoke-testing ${tasks.length} API handler modules…`)

  const results = { passed: 0, failed: 0 }

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    const outcomes = await Promise.all(
      batch.map(async ({ file, key }) => {
        const { ok, stderr } = await importInChild(file)
        return { key, ok, stderr }
      })
    )
    for (const { key, ok, stderr } of outcomes) {
      if (ok) {
        results.passed++
        if (VERBOSE) console.log(`  pass  ${key}`)
      } else {
        results.failed++
        console.error(`  FAIL  ${key}`)
        console.error(`        error:   ${stderr || '(no output)'}`)
      }
    }
  }

  console.log(`\n${results.passed} passed, ${results.failed} failed`)

  if (results.failed > 0) {
    console.error(
      '\nBundle smoke test failed — the handlers above would crash at cold-start in production.\n' +
      'Check the error message for the problematic import and fix the dependency before shipping.'
    )
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(2)
})
