#!/usr/bin/env node
// Route-resolution smoke for the function-consolidation rewrite.
// Hits every consolidated route (+ a few kept-separate probes) on a PREVIEW
// deployment with no auth and asserts the request REACHES a handler — i.e. it is
// NOT answered by the Express catch-all 404. Auth/validation 401/400/405/404
// from the handler itself all count as "resolved"; only the catch-all signature
// ({"error":"not_found","path":...}) counts as a routing miss.
//
// Preview deployments sit behind Vercel Deployment Protection, so requests go
// through `vercel curl` (auto-bypass). Usage:
//   node scripts/smoke-route-resolution.mjs https://bernard-xxxx-movebetter.vercel.app

import { readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { routePathFor } from './api-consolidation.config.mjs'

const URL_ARG = process.argv[2]
if (!URL_ARG) {
  console.error('usage: node scripts/smoke-route-resolution.mjs <preview-url>')
  process.exit(2)
}
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const ROUTES = join(ROOT, 'api', '_routes')
const toPosix = (p) => p.split(sep).join('/')

// Every probe spawns a fresh `vercel curl`, and each of those does its own auth
// + project + deployment resolution against the Vercel API before it ever sends
// the HTTP request. At 8-way concurrency across ~227 routes that burst trips
// Vercel's API rate limit: the CLI silently backs off and retries, so a call
// that normally takes ~1.2s takes 60–90s instead. The old 30s timeout killed
// those mid-retry and recorded them as "TRANSPORT ERROR" — reddening the check
// while every route was in fact resolving fine.
//
// Measured against a live preview (80 routes): concurrency 8 → 15 stalls / 269s;
// concurrency 2 → 0 stalls / 36s. Lower concurrency is both more reliable AND
// faster overall, because nothing burns a full timeout. The retry below absorbs
// residual throttling when several route-smoke jobs run at once (they all share
// one VERCEL_TOKEN, so the rate-limit bucket is repo-wide, not per-job).
const CONCURRENCY = 3
const HIT_TIMEOUT_MS = 60_000
const MAX_ATTEMPTS = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, acc)
    else if (name.endsWith('.js') && !name.endsWith('_manifest.generated.js')) acc.push(full)
  }
  return acc
}

// Express path -> concrete request path (fill :params / *splat with a dummy id).
function concrete(p) {
  return p.replace(/[:*]([A-Za-z0-9_]+)/g, 'smoke-test-id')
}

const consolidated = walk(ROUTES).map((abs) => routePathFor(toPosix(relative(ROUTES, abs))))

// Kept-separate probes — must reach the real function, NOT the catch-all.
const keptProbes = [
  '/api/health',
  '/api/media/smoke-test-id/edit', // dynamic keep — verifies the rewrite exclusion
  '/api/stream',
  '/api/cron/auto-publish',
]

const targets = [
  ...consolidated.map((p) => ({ path: concrete(p), kind: 'consolidated', route: p })),
  ...keptProbes.map((p) => ({ path: p, kind: 'kept', route: p })),
]

function hitOnce(path) {
  return new Promise((res) => {
    execFile(
      'vercel',
      ['curl', path, '--deployment', URL_ARG, '--', '-s', '-w', '\n%{http_code}'],
      { cwd: ROOT, timeout: HIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        const out = (stdout || '').trim()
        const nl = out.lastIndexOf('\n')
        const status = parseInt(nl >= 0 ? out.slice(nl + 1) : out, 10) || 0
        const body = nl >= 0 ? out.slice(0, nl) : ''
        const routingMiss = status === 404 && /"error"\s*:\s*"not_found"/.test(body) && /"path"\s*:/.test(body)
        res({ status, routingMiss, body: body.slice(0, 120), err: err?.message })
      },
    )
  })
}

// A status of 0 means the CLI never produced an HTTP status — throttled, killed
// by the timeout, or a transient network fault. None of those say anything about
// whether the ROUTE resolves, so retry with backoff before believing it. Only a
// real HTTP status (or a genuine routing miss) is a verdict worth reporting.
async function hit(path) {
  let last
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await hitOnce(path)
    if (last.status !== 0) return { ...last, attempts: attempt }
    if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt)
  }
  return { ...last, attempts: MAX_ATTEMPTS }
}

const misses = []
const errors = []
let done = 0

async function run() {
  console.log(`Route-resolution smoke against ${URL_ARG}`)
  console.log(`  ${consolidated.length} consolidated + ${keptProbes.length} kept probes\n`)
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    const outcomes = await Promise.all(batch.map((t) => hit(t.path).then((r) => ({ ...t, ...r }))))
    for (const o of outcomes) {
      done++
      if (o.status === 0) errors.push(o)
      else if (o.routingMiss) misses.push(o)
    }
    process.stdout.write(`\r  tested ${done}/${targets.length}`)
  }
  console.log('\n')
  if (misses.length) {
    console.log(`✗ ROUTING MISSES (${misses.length}) — reached catch-all 404:`)
    for (const m of misses) console.log(`    [${m.kind}] ${m.route}  →  ${m.path}`)
  }
  if (errors.length) {
    console.log(
      `\n⚠ TRANSPORT ERRORS (${errors.length}) — no HTTP status after ${MAX_ATTEMPTS} attempts ` +
        `(Vercel API throttling / protection / network). These are NOT routing failures:`,
    )
    for (const e of errors.slice(0, 20)) console.log(`    ${e.route}  ${e.err || ''}`)
    if (errors.length > 20) console.log(`    …and ${errors.length - 20} more (list truncated at 20)`)
  }
  const okCount = targets.length - misses.length - errors.length
  console.log(`\n${okCount}/${targets.length} routes resolved.`)
  if (misses.length || errors.length) process.exit(1)
  console.log('✓ all routes resolve to a handler')
}
run()
