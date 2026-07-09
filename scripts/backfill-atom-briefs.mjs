// Backfill a concrete one-line `brief` onto existing content_plan_atoms that
// have none. Two populations end up brief-less:
//   • grid-fallback atoms (planned_by null) — the template path never set one;
//   • pre-schema strategist atoms — the old hand-parsed LLM call dropped `brief`
//     on ~87% of pieces before it became a required schema field.
// Both leave backlog/calendar rows showing only the generic angle category
// ("The Hook", "Movement Principle"), so every piece in an angle looks identical.
//
// This does NOT re-plan (no re-allocation, no re-scheduling) — it only LABELS
// atoms that already exist, in place, by their id. One LLM call per interview
// reading the fuller summary + topic + that interview's null-brief atoms, then a
// PATCH per atom. Idempotent: only touches atoms whose brief is null/empty.
//
// Run (dry-run): node scripts/backfill-atom-briefs.mjs --dry-run
// Run (one ws):  node scripts/backfill-atom-briefs.mjs --slug movebetter
// Run (apply):   node scripts/backfill-atom-briefs.mjs
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY in env.

import { generateObject } from 'ai'
import { z } from 'zod'

const DRY = process.argv.includes('--dry-run')
const slugArg = (() => {
  const i = process.argv.indexOf('--slug')
  return i >= 0 ? process.argv[i + 1] : null
})()
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE env'); process.exit(1) }
if (!process.env.AI_GATEWAY_API_KEY) { console.error('Missing AI_GATEWAY_API_KEY'); process.exit(1) }

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', ...init.headers,
    },
  })
}
const j = async (r) => (r.ok ? r.json() : [])

// One brief per atom id. `brief` is a REQUIRED key (forces the model to emit one
// per piece) but length is NOT schema-constrained — a hard .max() makes
// generateObject reject the whole response when a single brief runs long (this
// zeroed every interview on the first dry-run). Kept short via prompt + truncated
// on store instead.
const BRIEF_MAX = 90
const briefSchema = z.object({
  briefs: z.array(z.object({
    id: z.string().describe('The atom id, copied verbatim from the input.'),
    brief: z.string().describe(
      "A concrete one-line brief (aim for under 90 characters): the specific subject + the clinician's own framing, NOT a generic angle name.",
    ),
  })),
})
function normalizeBrief(brief) {
  const t = String(brief || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > BRIEF_MAX ? `${t.slice(0, BRIEF_MAX - 1).trimEnd()}…` : t
}

async function briefsForInterview({ topic, summary, atoms }) {
  const atomLines = atoms
    .map((a) => `- [${a.id}] ${a.platform} · ${a.angle_label || a.angle}`)
    .join('\n')
  const instructions =
    `You label already-planned social pieces for a clinical practice. For EACH piece below, ` +
    `write a concrete one-line brief: the specific subject + the clinician's own framing, never ` +
    `a generic angle name — a reader should know exactly what the post is about from the brief ` +
    `alone. Two pieces from this same interview must have DISTINCT briefs (lean on the piece's ` +
    `channel + angle to differentiate). NEVER begin a brief with the channel or angle name (e.g. ` +
    `do not write "Instagram hook:" or "LinkedIn clinical perspective:") — the reader already ` +
    `sees both; open with the subject. Return one brief per piece id, ids copied verbatim.`
  const user =
    `INTERVIEW TOPIC: ${topic || '(untitled)'}\n\n` +
    `WHAT THE CLINICIAN SAID:\n${(summary || topic || '').slice(0, 1500)}\n\n` +
    `PIECES TO LABEL (id · channel · angle):\n${atomLines}`
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4-6',
    schema: briefSchema,
    instructions,
    messages: [{ role: 'user', content: user }],
    maxOutputTokens: 2000,
  })
  return Array.isArray(object?.briefs) ? object.briefs : []
}

// Workspaces in scope.
let wsList = await j(await sb('workspaces?status=eq.active&select=id,slug'))
if (slugArg) wsList = wsList.filter((w) => w.slug === slugArg)
console.log(`\n${DRY ? '[DRY RUN] ' : ''}Brief backfill over ${wsList.length} workspace(s)${slugArg ? ` (--slug ${slugArg})` : ''}\n`)

let totalPatched = 0
for (const ws of wsList) {
  // Null/empty-brief atoms + their source interview topic/summary, one query.
  const atoms = await j(await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&or=(brief.is.null,brief.eq.)` +
    `&select=id,platform,angle,angle_label,interview_id,interview:interviews!interview_id(topic,summary_text)`,
  ))
  if (!atoms.length) { console.log(`  ${ws.slug}: 0 brief-less atoms`); continue }

  // Group by interview so each interview is one LLM call.
  const byInterview = new Map()
  for (const a of atoms) {
    if (!a.interview_id) continue
    if (!byInterview.has(a.interview_id)) byInterview.set(a.interview_id, { interview: a.interview, atoms: [] })
    byInterview.get(a.interview_id).atoms.push(a)
  }
  console.log(`  ${ws.slug}: ${atoms.length} brief-less atoms across ${byInterview.size} interview(s)${DRY ? '' : ' (labeling…)'}`)

  for (const [interviewId, { interview, atoms: group }] of byInterview) {
    let briefs = []
    try {
      briefs = await briefsForInterview({ topic: interview?.topic, summary: interview?.summary_text, atoms: group })
    } catch (e) {
      console.error(`      interview ${interviewId}: brief gen failed: ${e?.message}`)
      continue
    }
    const briefById = new Map(briefs.map((b) => [String(b.id).replace(/\s+/g, ''), normalizeBrief(b.brief)]))
    let patched = 0
    for (const a of group) {
      const brief = briefById.get(a.id)
      if (!brief) continue
      if (DRY) {
        console.log(`      ${a.platform.padEnd(10)} ${(a.angle_label || a.angle).padEnd(22)} → ${brief}`)
        patched++
        continue
      }
      const res = await sb(`content_plan_atoms?id=eq.${a.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH', body: JSON.stringify({ brief }), headers: { Prefer: 'return=minimal' },
      })
      if (res.ok) patched++
      else console.error(`      PATCH ${a.id} failed ${res.status}: ${(await res.text()).slice(0, 160)}`)
    }
    totalPatched += patched
  }
}
console.log(`\n${DRY ? '[DRY RUN] would label' : 'Labeled'} ${totalPatched} atoms.\n`)
