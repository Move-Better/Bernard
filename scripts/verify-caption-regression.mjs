#!/usr/bin/env node
/**
 * Caption-fidelity REGRESSION gate — the golden-set successor to
 * verify-caption-fidelity.mjs.
 *
 * WHY THIS EXISTS, and why it is shaped differently.
 *
 * The old gate stored SCORED SAMPLES pulled fresh from live data, and expired
 * them after 30 days. Two problems, one fatal:
 *
 *   1. Every refresh changed both the inputs AND the scores, so the baseline
 *      was never comparable to itself. A drop could mean "our prompt
 *      regressed" or just "this month's captions were about different
 *      topics" — and there was no way to tell which. That is the opposite of
 *      what a regression gate is for.
 *   2. The refresh path required >= 5 `complete` story_packages. Exactly ONE
 *      exists in prod (newest 2026-06-02) because the pipeline moved to
 *      content_items/moments. So the fixture expired on a timer nothing could
 *      reset, and the gate failed every PR in the repo while measuring nothing.
 *
 * This gate inverts it: commit the INPUTS, not the scores.
 *
 *   • The fixture holds real captions + their source transcripts, frozen
 *     deliberately. They do not go stale, because being fixed is the point.
 *   • CI re-scores them on every run with the CURRENT prompt and CURRENT judge
 *     — the same buildFidelityPrompt/parseFidelity the product uses, so this
 *     cannot drift from what ships (the two-rubric-parsers lesson).
 *   • The result is compared against a committed baseline. Inputs never move,
 *     so a drop is unambiguously a regression in the prompt or the judge.
 *   • No expiry. A baseline is refreshed DELIBERATELY, when a change is
 *     intended to move it — with --update-baseline, which prints the delta so
 *     nobody rubber-stamps a silent decline.
 *
 * Usage:
 *   node scripts/verify-caption-regression.mjs
 *   node scripts/verify-caption-regression.mjs --update-baseline
 *   node scripts/verify-caption-regression.mjs --build-fixture   (needs DB)
 *
 * Env: AI_GATEWAY_API_KEY (to score). SUPABASE_* only for --build-fixture.
 * Skips cleanly (exit 0) when the key is absent, so a fork PR is not blocked.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { buildFidelityPrompt, parseFidelity, FIDELITY_DIMENSIONS } from '../api/_lib/captionFidelityRubric.js'

const FIXTURE_PATH = '.claude/caption-regression-fixture.json'
const MODEL = process.env.VOICE_FIDELITY_MODEL || 'anthropic/claude-haiku-4-5'
// Tolerance below the committed baseline before this fails. Wider than the old
// gate's 5% because a single judge call is stochastic — see the repeat logic.
const PCT = parseFloat(process.env.CAPTION_REGRESSION_PCT || '0.08')
// Each caption is scored REPEATS times and averaged. A single-shot LLM score
// swings enough to flip a tight gate on noise; this is the cheapest defence.
const REPEATS = parseInt(process.env.CAPTION_REGRESSION_REPEATS || '2', 10)

const args = new Set(process.argv.slice(2))
const out = (l) => process.stdout.write(`${l}\n`)
const skip = (r) => { out(`⚠ caption-regression skipped: ${r}`); process.exit(0) }
const pass = (r) => { out(`✓ caption-regression pass: ${r}`); process.exit(0) }
const fail = (r) => { out(`✗ caption-regression FAIL: ${r}`); process.exit(1) }

// ── --build-fixture ───────────────────────────────────────────────────────
// Freezes real captions + their source transcripts as the corpus. Run
// deliberately, rarely. The transcript matters as much as the caption: the
// said_fidelity dimension grades the caption AGAINST it, and a judge that never
// receives the reference cannot measure faithfulness even in principle (the U1
// keystone, PR #1081).
if (args.has('--build-fixture')) {
  const URL_ = process.env.SUPABASE_URL
  const KEY = process.env.SUPABASE_SERVICE_KEY
  if (!URL_ || !KEY) fail('--build-fixture needs SUPABASE_URL + SUPABASE_SERVICE_KEY')
  const q = async (path) => {
    const r = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    })
    if (!r.ok) throw new Error(`${path} -> ${r.status}`)
    return r.json()
  }
  const wsSlug = process.env.CAPTION_REGRESSION_WORKSPACE || 'movebetter'
  const [ws] = await q(`workspaces?slug=eq.${wsSlug}&select=id,display_name&limit=1`)
  if (!ws) fail(`workspace ${wsSlug} not found`)
  const rows = await q(
    `content_items?workspace_id=eq.${ws.id}&status=in.(approved,scheduled,published)` +
    `&interview_id=not.is.null&select=id,topic,content,platform,interview_id,staff_id` +
    `&order=created_at.desc&limit=40`,
  )
  const picked = rows.filter((r) => (r.content || '').length >= 200 && (r.content || '').length <= 900).slice(0, 10)
  if (picked.length < 5) fail(`only ${picked.length} eligible captions — need >= 5`)

  const samples = []
  for (const r of picked) {
    const [iv] = await q(`interviews?id=eq.${r.interview_id}&select=messages&limit=1`)
    const transcript = Array.isArray(iv?.messages)
      ? iv.messages.map((m) => `${m.role === 'user' ? 'Clinician' : 'Bernard'}: ${m.content}`).join('\n').slice(0, 8000)
      : ''
    let staffName = ''
    if (r.staff_id) {
      const [st] = await q(`staff?id=eq.${r.staff_id}&select=name&limit=1`)
      staffName = st?.name || ''
    }
    samples.push({
      id: r.id.slice(0, 8),
      topic: r.topic || '',
      platform: r.platform,
      caption: r.content,
      transcript,
      staffName,
      workspaceName: ws.display_name || wsSlug,
    })
  }
  await writeFile(FIXTURE_PATH, `${JSON.stringify({
    meta: {
      builtAt: new Date().toISOString(),
      note: 'FROZEN inputs. Do NOT auto-refresh — a moving corpus makes the baseline incomparable to itself, which is what the predecessor gate got wrong.',
      workspace: wsSlug,
    },
    baseline: null,
    samples,
  }, null, 2)}\n`)
  out(`✅ wrote ${samples.length} frozen samples to ${FIXTURE_PATH}`)
  out('   next: node scripts/verify-caption-regression.mjs --update-baseline')
  process.exit(0)
}

if (!existsSync(FIXTURE_PATH)) {
  skip(`no fixture at ${FIXTURE_PATH} — build one with --build-fixture`)
}
if (!process.env.AI_GATEWAY_API_KEY) {
  // Not a failure: a fork PR has no gateway key, and blocking those would make
  // the gate a availability problem rather than a quality one.
  skip('AI_GATEWAY_API_KEY not set')
}

const fixture = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'))
const samples = Array.isArray(fixture?.samples) ? fixture.samples : []
if (samples.length < 5) fail(`fixture has ${samples.length} samples (need >= 5)`)

async function scoreOnce(sample) {
  const { instructions, user } = buildFidelityPrompt({
    topic: sample.topic,
    caption: sample.caption,
    transcript: sample.transcript || '',
    phrases: sample.phrases || [],
    staffName: sample.staffName || '',
    workspaceName: sample.workspaceName || '',
  })
  const r = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: user }],
      max_tokens: 900,
    }),
  })
  if (!r.ok) throw new Error(`gateway ${r.status}`)
  const j = await r.json()
  const text = j?.choices?.[0]?.message?.content || ''
  const parsed = parseFidelity(text)
  // A null score is NOT a zero — that conflation is exactly how the #1881 gate
  // silently became a no-op for weeks. Surface it as unparseable instead.
  if (!parsed || typeof parsed.overall !== 'number') return null
  return parsed.overall
}

async function scoreSample(sample) {
  const runs = []
  for (let i = 0; i < REPEATS; i++) {
    try {
      const v = await scoreOnce(sample)
      if (v != null) runs.push(v)
    } catch (e) {
      out(`  ! ${sample.id}: ${e.message}`)
    }
  }
  return runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : null
}

out(`Scoring ${samples.length} frozen captions x${REPEATS} with ${MODEL}…`)
const scored = []
for (const s of samples) {
  const v = await scoreSample(s)
  out(`  ${s.id.padEnd(12)} ${v == null ? 'UNPARSEABLE' : v.toFixed(2)}`)
  if (v != null) scored.push({ id: s.id, overall: v })
}

// An all-null run means the JUDGE broke, not that quality collapsed. Failing on
// a 0.00 average here would be a false alarm; failing on "the judge returned
// nothing" is the true finding. (#1881: a judge missing its system prompt
// produced zero parseable scores and the gate silently stopped gating.)
if (scored.length === 0) fail('every sample was unparseable — the JUDGE is broken, not the captions')
if (scored.length < samples.length) {
  out(`⚠ ${samples.length - scored.length} of ${samples.length} unparseable — judged on the rest`)
}

const avg = scored.reduce((s, x) => s + x.overall, 0) / scored.length

if (args.has('--update-baseline')) {
  const prev = fixture.baseline
  fixture.baseline = Number(avg.toFixed(3))
  fixture.baselineUpdatedAt = new Date().toISOString()
  fixture.baselineModel = MODEL
  await writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
  const delta = typeof prev === 'number' ? avg - prev : null
  out(`baseline ${prev ?? '(none)'} → ${fixture.baseline}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta.toFixed(3)})`}`)
  if (delta != null && delta < 0) {
    // Printed loudly on purpose: silently re-baselining a decline is how a
    // quality gate ratchets downward while always looking green.
    out('⚠ baseline moved DOWN — confirm this was intended, not a regression you just enshrined.')
  }
  process.exit(0)
}

if (typeof fixture.baseline !== 'number') {
  skip('fixture has no baseline yet — set one with --update-baseline')
}

const floor = fixture.baseline * (1 - PCT)
out(`  baseline: ${fixture.baseline.toFixed(2)}   floor: ${floor.toFixed(2)}   now: ${avg.toFixed(2)} (n=${scored.length})`)

if (avg < floor) {
  const worst = [...scored].sort((a, b) => a.overall - b.overall).slice(0, 5)
  out('')
  out('  lowest-scoring frozen captions:')
  for (const w of worst) out(`    ${w.id}  ${w.overall.toFixed(2)}`)
  fail(`avg ${avg.toFixed(2)} < floor ${floor.toFixed(2)} — the prompt or the judge regressed against a FIXED corpus`)
}

pass(`avg ${avg.toFixed(2)} >= floor ${floor.toFixed(2)} (dimensions: ${FIDELITY_DIMENSIONS.join(', ')})`)
