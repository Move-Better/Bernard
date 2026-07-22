#!/usr/bin/env node
// Route-resolution smoke for the function-consolidation rewrite.
// Hits every consolidated route (+ a few kept-separate probes) on a PREVIEW
// deployment with no auth and asserts the request REACHES a handler — i.e. it is
// NOT answered by the Express catch-all 404. Auth/validation 401/400/405/404
// from the handler itself all count as "resolved"; only the catch-all signature
// ({"error":"not_found","path":...}) counts as a routing miss.
//
// Preview deployments sit behind Vercel Deployment Protection. We get past that
// with Protection Bypass for Automation — a project-level secret sent as the
// `x-vercel-protection-bypass` header — NOT by shelling out to `vercel curl`.
//
// Why not `vercel curl` (the previous approach, see #2248): every probe spawned
// a fresh CLI process that did its own auth + project + deployment resolution
// against the Vercel API before sending the request. Across ~230 routes that
// burst tripped Vercel's API rate limit; the CLI silently backed off and
// retried, so a ~1.2s call became 60-90s and the script's timeout killed it and
// recorded a bogus "TRANSPORT ERROR" for a route that resolved perfectly well.
// Worse, every concurrent route-smoke job shares one VERCEL_TOKEN, so the
// rate-limit bucket is repo-wide: four overlapping jobs on 2026-07-22 each took
// 11m46s-13m27s against a 15min cap.
//
// Plain fetch removes the CLI entirely — no process spawns, and exactly ONE
// Vercel API call (to read the bypass secret) instead of ~230. Measured per
// route: ~0.2s vs ~1.2s best-case for `vercel curl`, and no throttling at all.
//
// Usage:
//   node scripts/smoke-route-resolution.mjs https://bernard-xxxx-movebetter.vercel.app
//
// Auth: set VERCEL_AUTOMATION_BYPASS_SECRET directly, or set VERCEL_TOKEN and
// the secret is resolved from the project automatically.

import { readdirSync, statSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { routePathFor } from './api-consolidation.config.mjs'

const URL_ARG = process.argv[2]
if (!URL_ARG) {
  console.error('usage: node scripts/smoke-route-resolution.mjs <preview-url>')
  process.exit(2)
}
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const ROUTES = join(ROOT, 'api', '_routes')
const toPosix = (p) => p.split(sep).join('/')

// No CLI processes and no Vercel API calls per probe, so this can be far higher
// than the 3 the `vercel curl` era was forced down to. These are plain HTTPS
// requests to the preview deployment itself.
const CONCURRENCY = 12
const HIT_TIMEOUT_MS = 30_000
const MAX_ATTEMPTS = 3
const VERCEL_API = 'https://api.vercel.com'
const PROJECT = process.env.VERCEL_PROJECT_NAME || 'bernard'
const TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || 'movebetter'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(path, token) {
  const r = await fetch(`${VERCEL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.error) throw new Error(`${path} -> ${r.status} ${j?.error?.message || ''}`.trim())
  return j
}

// Prefer an explicitly supplied secret; otherwise derive it from the token CI
// already has, so this needs no new GitHub secret and no extra rotation surface.
async function resolveBypassSecret() {
  const direct = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (direct) return { secret: direct, source: 'VERCEL_AUTOMATION_BYPASS_SECRET' }

  const token = process.env.VERCEL_TOKEN
  if (!token) {
    throw new Error(
      'need VERCEL_AUTOMATION_BYPASS_SECRET, or VERCEL_TOKEN to resolve it from the project',
    )
  }
  const teams = await api('/v2/teams', token)
  const teamId = teams.teams?.find((t) => t.slug === TEAM_SLUG)?.id
  if (!teamId) throw new Error(`team "${TEAM_SLUG}" not visible to this token`)

  const project = await api(`/v9/projects/${PROJECT}?teamId=${teamId}`, token)
  const secret = Object.keys(project.protectionBypass || {})[0]
  if (!secret) {
    throw new Error(
      `project "${PROJECT}" has no Protection Bypass for Automation configured — ` +
        'add one under Settings > Deployment Protection',
    )
  }
  return { secret, source: `project ${PROJECT} (via VERCEL_TOKEN)` }
}

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

async function hitOnce(path, secret) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HIT_TIMEOUT_MS)
  try {
    const r = await fetch(`${URL_ARG}${path}`, {
      headers: { 'x-vercel-protection-bypass': secret },
      // Never follow redirects — a followed SSO bounce would return the login
      // page's 200 and read as a healthy route.
      redirect: 'manual',
      signal: ctrl.signal,
    })
    const body = await r.text().catch(() => '')
    // Not every 3xx is a protection failure: plenty of handlers redirect for
    // real (e.g. /api/oauth/*/callback -> /settings/integrations?...). Only a
    // bounce to Vercel's SSO gate means the bypass didn't take. Distinguish by
    // Location — SSO goes to vercel.com/sso-api, app redirects don't.
    const location = r.headers.get('location') || ''
    const ssoBlocked =
      r.status >= 300 && r.status < 400 && /vercel\.com\/sso-api|_vercel_sso_nonce/.test(location)
    const routingMiss =
      r.status === 404 && /"error"\s*:\s*"not_found"/.test(body) && /"path"\s*:/.test(body)
    return { status: r.status, routingMiss, ssoBlocked, body: body.slice(0, 120) }
  } catch (e) {
    return { status: 0, routingMiss: false, body: '', err: e?.message }
  } finally {
    clearTimeout(timer)
  }
}

// A status of 0 means no HTTP response at all — a socket error or an abort.
// That says nothing about whether the ROUTE resolves, so retry before believing
// it. Only a real HTTP status (or a genuine routing miss) is a verdict.
async function hit(path, secret) {
  let last
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await hitOnce(path, secret)
    if (last.status !== 0) return { ...last, attempts: attempt }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * attempt)
  }
  return { ...last, attempts: MAX_ATTEMPTS }
}

const misses = []
const errors = []
const blocked = []
let done = 0

async function run() {
  console.log(`Route-resolution smoke against ${URL_ARG}`)
  const { secret, source } = await resolveBypassSecret()
  console.log(`  protection bypass: ${source}`)
  console.log(`  ${consolidated.length} consolidated + ${keptProbes.length} kept probes`)
  console.log(`  concurrency ${CONCURRENCY}\n`)

  const started = Date.now()
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY)
    const outcomes = await Promise.all(
      batch.map((t) => hit(t.path, secret).then((r) => ({ ...t, ...r }))),
    )
    for (const o of outcomes) {
      done++
      if (o.status === 0) errors.push(o)
      else if (o.ssoBlocked) blocked.push(o)
      else if (o.routingMiss) misses.push(o)
    }
    process.stdout.write(`\r  tested ${done}/${targets.length}`)
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log('\n')

  // A redirect means Deployment Protection answered instead of the app, so every
  // result this run is meaningless. Call that out rather than reporting ~230
  // "routing misses" and sending someone hunting a routing bug that isn't there.
  if (blocked.length) {
    console.log(
      `✗ DEPLOYMENT PROTECTION (${blocked.length}) — got a redirect instead of the app. ` +
        'The bypass secret is wrong or was rotated; results below are not meaningful:',
    )
    for (const b of blocked.slice(0, 5)) console.log(`    ${b.route}  →  HTTP ${b.status}`)
    process.exit(1)
  }
  if (misses.length) {
    console.log(`✗ ROUTING MISSES (${misses.length}) — reached catch-all 404:`)
    for (const m of misses) console.log(`    [${m.kind}] ${m.route}  →  ${m.path}`)
  }
  if (errors.length) {
    console.log(
      `\n⚠ TRANSPORT ERRORS (${errors.length}) — no HTTP status after ${MAX_ATTEMPTS} attempts ` +
        '(network / timeout). These are NOT routing failures:',
    )
    for (const e of errors.slice(0, 20)) console.log(`    ${e.route}  ${e.err || ''}`)
    if (errors.length > 20) console.log(`    …and ${errors.length - 20} more (list truncated at 20)`)
  }
  const okCount = targets.length - misses.length - errors.length
  console.log(`\n${okCount}/${targets.length} routes resolved in ${elapsed}s.`)
  if (misses.length || errors.length) process.exit(1)
  console.log('✓ all routes resolve to a handler')
}

run().catch((e) => {
  console.error(`\nsmoke failed to run: ${e.message}`)
  process.exit(2)
})
