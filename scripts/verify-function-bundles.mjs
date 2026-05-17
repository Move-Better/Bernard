#!/usr/bin/env node
// Smoke-tests every Node-runtime Vercel function bundle by attempting a
// dynamic import of its entry point. Catches ERR_INTERNAL_ASSERTION and
// similar load-time crashes (e.g. esbuild picking the wrong conditional-export
// for a native dependency) before they reach production.
//
// Run after `vercel build` or `npx vercel build --yes`. The .vercel/output
// directory must already exist; this script does not call vercel itself.
//
// Usage:
//   node scripts/verify-function-bundles.mjs [--verbose]

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VERBOSE = process.argv.includes('--verbose')
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const FUNCTIONS_DIR = join(ROOT, '.vercel', 'output', 'functions')
const NODE_MODULES = join(ROOT, 'node_modules')

// Functions that cannot be import-tested in isolation. Each entry must
// include a comment explaining why. Keep this list as short as possible —
// any function added here is a blindspot for the ERR_INTERNAL_ASSERTION class
// of crashes.
const ALLOWLIST = new Set([
  // (currently empty — add entries here only when a function provably requires
  // a runtime env var to be present before the module graph can be loaded,
  // not merely because it uses an env var at call time)
])

const CONCURRENCY = 10
const IMPORT_TIMEOUT_MS = 15_000

// ─── helpers ─────────────────────────────────────────────────────────────────

async function findFuncDirs(dir) {
  const results = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (!e.isDirectory()) continue
    if (e.name.endsWith('.func')) {
      results.push(full)
    } else {
      results.push(...await findFuncDirs(full))
    }
  }
  return results
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function importInChild(funcDir, handler) {
  return new Promise((resolve) => {
    const script =
      `import('./${handler}')` +
      `.then(()=>process.exit(0))` +
      `.catch(e=>{process.stderr.write((e.code?e.code+': ':'')+e.message+'\\n');process.exit(1)})`

    const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: funcDir,
      env: { ...process.env, NODE_PATH: NODE_MODULES },
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
  // Verify the vercel build output exists.
  try {
    await stat(FUNCTIONS_DIR)
  } catch {
    console.error('ERROR: .vercel/output/functions not found.')
    console.error('Run `npx vercel build --yes` before this script.')
    process.exit(2)
  }

  const funcDirs = await findFuncDirs(FUNCTIONS_DIR)
  const tasks = []

  for (const funcDir of funcDirs) {
    const config = await readJson(join(funcDir, '.vc-config.json'))
    if (!config) continue

    const { runtime, handler } = config
    if (!runtime?.startsWith('nodejs') || !handler) continue

    const key = relative(FUNCTIONS_DIR, funcDir)
    if (ALLOWLIST.has(key)) {
      if (VERBOSE) console.log(`  skip  ${key}  (allowlisted)`)
      continue
    }

    tasks.push({ funcDir, handler, key })
  }

  console.log(`Smoke-testing ${tasks.length} Node function bundles…`)

  const results = { passed: 0, failed: 0, errors: [] }

  // Process in batches of CONCURRENCY.
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY)
    const outcomes = await Promise.all(
      batch.map(async ({ funcDir, handler, key }) => {
        const { ok, stderr } = await importInChild(funcDir, handler)
        return { key, handler, ok, stderr }
      })
    )
    for (const { key, handler, ok, stderr } of outcomes) {
      if (ok) {
        results.passed++
        if (VERBOSE) console.log(`  pass  ${key}`)
      } else {
        results.failed++
        results.errors.push({ key, handler, stderr })
        console.error(`  FAIL  ${key}`)
        console.error(`        handler: ${handler}`)
        console.error(`        error:   ${stderr || '(no output)'}`)
      }
    }
  }

  console.log(`\n${results.passed} passed, ${results.failed} failed`)

  if (results.failed > 0) {
    console.error(
      '\nBundle smoke test failed — the functions above would crash at cold-start in production.\n' +
      'Check the error message for the problematic import and fix the dependency before shipping.'
    )
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(2)
})
