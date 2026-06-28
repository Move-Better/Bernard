// Validate the F6 supersession judge BEFORE trusting it to gate suppression
// (validate-the-validator). Two batteries:
//   1. Synthetic probes — controlled pairs with a known expected label. Tests
//      that the judge detects a real stance-change AND (critically) does NOT
//      call a derivation/rewrite a supersession.
//   2. Real pairs — pulls each of a few recent content chunks' nearest neighbor
//      via the live match RPC and judges it. In this young corpus the nearest
//      neighbors are derivations (blog<->its interview), so EVERY real pair
//      should come back NON-"supersedes". A "supersedes" here is a false positive.
//
// Each pair is judged 3x (majority) since single-shot LLM calls swing.
// Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY, AI_GATEWAY_API_KEY.

import { judgeSupersessionStable } from '../api/_lib/supersessionJudge.js'
import { embedTexts } from '../api/_lib/embeddings.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...init.headers },
  })
}

// ── Battery 1: synthetic probes ────────────────────────────────────────────
const PROBES = [
  {
    name: 'POSITION REVERSAL → supersedes',
    expect: 'supersedes',
    newer: "I no longer recommend bed rest for acute low back pain. The evidence is clear now: staying gently active and moving early actually heals faster, and prolonged bed rest delays recovery and weakens the supporting muscles.",
    older: "For acute low back pain, my advice is a few days of bed rest to let the inflammation settle before you start moving around again.",
  },
  {
    name: 'ADDED NUANCE → refines',
    expect: 'refines',
    newer: "Drink plenty of water after an adjustment — ideally about 16oz within the first hour — to help your body flush out the byproducts the adjustment releases.",
    older: "It's a good idea to drink water after an adjustment.",
  },
  {
    name: 'DERIVATION / REWRITE → duplicate (the critical guardrail)',
    expect: 'duplicate',
    newer: "Most people think chiropractic is just about cracking backs, but really it's about restoring proper movement to joints so the nervous system can do its job. When a joint is stuck, your brain gets noisy signals — and an adjustment quiets that down.",
    older: "So a lot of folks assume we just crack backs, you know? But what we're actually doing is getting motion back into a joint that's stuck. When it's stuck the nervous system gets all this noise, and the adjustment kind of settles it.",
  },
  {
    name: 'DIFFERENT FACET, SAME TOPIC → compatible',
    expect: 'compatible',
    newer: "Posture matters most during the hours you're sitting at a desk — set your screen at eye level and your feet flat.",
    older: "Posture during sleep is underrated — a pillow that keeps your neck neutral makes a big difference.",
  },
]

async function runSynthetic() {
  console.log('\n=== Battery 1: synthetic probes (expected vs actual, 3 samples) ===')
  let pass = 0
  for (const p of PROBES) {
    const r = await judgeSupersessionStable({ newerText: p.newer, olderText: p.older, samples: 3 })
    const ok = r.relationship === p.expect
    // The load-bearing property: derivation/refine/compatible must NOT be "supersedes".
    const noFalsePositive = p.expect === 'supersedes' ? true : r.relationship !== 'supersedes'
    if (ok) pass++
    console.log(
      `  [${ok ? 'PASS' : (noFalsePositive ? 'soft' : 'FAIL')}] ${p.name}\n` +
      `        expected=${p.expect}  got=${r.relationship}  agree=${r.votes}/${r.samples}  conf=${r.meanConfidence.toFixed(2)}  runs=[${r.runs.join(',')}]`
    )
  }
  console.log(`  → ${pass}/${PROBES.length} exact-match; the critical check is that non-reversals never return "supersedes".`)
}

// ── Battery 2: real nearest-neighbor pairs ─────────────────────────────────
async function runReal(n = 4) {
  console.log('\n=== Battery 2: real nearest-neighbor pairs (should all be NON-supersedes) ===')
  const r = await sb('practice_memory_chunks?source_type=eq.content_item&select=id,workspace_id,staff_id,source_label,text,embedding,source_date&order=source_date.desc&limit=' + n)
  if (!r.ok) { console.error('fetch chunks failed', r.status); return }
  const chunks = await r.json()
  let falsePos = 0
  for (const c of chunks) {
    if (!c.staff_id || !c.embedding) continue
    const emb = typeof c.embedding === 'string' ? c.embedding : `[${c.embedding.join(',')}]`
    const m = await sb('rpc/match_practice_memory_chunks', {
      method: 'POST',
      body: JSON.stringify({
        p_workspace_id: c.workspace_id, p_staff_id: c.staff_id, p_query_embedding: emb,
        p_match_count: 3, p_exclude_source_ids: [c.source_id ?? c.id], p_source_types: null, p_half_life_days: null,
      }),
    })
    if (!m.ok) { console.error('  rpc failed', m.status); continue }
    const neighbors = await m.json()
    const nb = neighbors.find((x) => x.id !== c.id)
    if (!nb) { console.log(`  (no neighbor for ${c.source_label?.slice(0,30)})`); continue }
    const res = await judgeSupersessionStable({
      newerText: c.text, olderText: nb.text,
      newerLabel: c.source_label, olderLabel: nb.source_label, samples: 3,
    })
    if (res.relationship === 'supersedes') falsePos++
    console.log(
      `  [${res.relationship === 'supersedes' ? 'FALSE-POS' : 'ok'}] "${(c.source_label||'').slice(0,32)}"  vs  "${(nb.source_label||'').slice(0,32)}"  sim=${(nb.similarity||0).toFixed(2)}\n` +
      `        → ${res.relationship} (${res.votes}/${res.samples}, conf ${res.meanConfidence.toFixed(2)})`
    )
  }
  console.log(`  → ${falsePos} false-positive supersedes out of ${chunks.length} real pairs (want 0).`)
}

async function main() {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'OPENAI_API_KEY', 'AI_GATEWAY_API_KEY']) {
    if (!process.env[k]) { console.error(`Missing env ${k}`); process.exit(1) }
  }
  // Touch embedTexts import so the bundle/lint sees it used if Battery 2 ever needs local embeds.
  void embedTexts
  await runSynthetic()
  await runReal()
}

main().catch((e) => { console.error(e); process.exit(1) })
