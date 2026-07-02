// Question-tactic library for the clinical interviewer (Phase 2 of the
// evolving-interviewer redesign). Shared by the prompt builder (client,
// src/lib/prompts.js) and the post-interview style classifier (server,
// api/_lib/interviewStyleClassifier.js) so the tactic vocabulary can never
// drift between the two (the "one shared rubric module" rule). Dependency-free.
//
// kind:
//   'lead' — distinctive opening/framing moves that should ROTATE across a
//            clinician's sessions; tracked in the style ledger for anti-repeat.
//   'core' — structural deep-dive moves that recur in any good clinical
//            interview (you almost always push on mechanism); always available,
//            never penalized as a "repeat".

export const INTERVIEW_TACTICS = [
  { id: 'case_first',       kind: 'lead', label: 'Case-first',         desc: 'Open on a specific recent or surprising patient.' },
  { id: 'contrarian',       kind: 'lead', label: 'Contrarian',         desc: 'Name the conventional take and ask what it gets wrong.' },
  { id: 'steelman',         kind: 'lead', label: 'Steelman',           desc: 'Ask them to make the best case for the approach they do NOT use.' },
  { id: 'teach_resident',   kind: 'lead', label: 'Teach-the-resident', desc: 'Ask the one thing they would drill into a new grad shadowing them.' },
  { id: 'whats_changed',    kind: 'lead', label: "What's-changed",     desc: 'Ask how their approach differs from 10 years ago and what changed their mind.' },
  { id: 'edge_case',        kind: 'lead', label: 'Edge-case',          desc: 'Ask who this does NOT work for and how they spot them.' },
  { id: 'disagreement',     kind: 'lead', label: 'Disagreement',       desc: 'Ask where they and a respected colleague genuinely disagree.' },
  { id: 'first_principles', kind: 'lead', label: 'First-principles',   desc: 'Ask them to invent the approach from scratch, ignoring the protocol.' },
  { id: 'origin_story',     kind: 'lead', label: 'Origin-story',       desc: 'Ask when they first realized the conventional approach was not enough.' },
  { id: 'mechanism_push',   kind: 'core', label: 'Mechanism-push',     desc: 'Push down a level on WHY something works, mechanistically.' },
  { id: 'concrete_metric',  kind: 'core', label: 'Concrete-metric',    desc: 'Ask what number or marker tells them it is actually working.' },
]

export const LEAD_TACTICS = INTERVIEW_TACTICS.filter((t) => t.kind === 'lead')
export const TACTIC_IDS = INTERVIEW_TACTICS.map((t) => t.id)
const VALID_IDS = new Set(TACTIC_IDS)
export function isTacticId(id) {
  return VALID_IDS.has(id)
}

// Static toolkit block — injected into every clinical interview prompt.
export function buildTacticLibraryBlock() {
  const lines = INTERVIEW_TACTICS.map((t) => `- ${t.label.toUpperCase()}: ${t.desc}`).join('\n')
  return `QUESTION TACTICS — your toolkit for cracking open a thread. Rotate through them; never lean on the same one twice in a row, and vary them across the interview so it never feels like a checklist:
${lines}
(Putting a sharp point into plain patient words is your TRANSLATE beat — keep using it there; it is not a tactic.)`
}

// Anti-repeat + register-memory block, built from staff.interview_style_memory.
// Returns '' when there's no usable history, so a first-ever interview's prompt
// is byte-identical to the no-memory case.
export function buildStyleMemoryBlock({ staffName, styleMemory } = {}) {
  const mem = styleMemory && typeof styleMemory === 'object' ? styleMemory : null
  if (!mem) return ''
  const leadById = new Map(LEAD_TACTICS.map((t) => [t.id, t.label]))
  const sessions = Array.isArray(mem.sessions) ? mem.sessions.slice(-2) : []
  const recentLead = [...new Set(sessions.flatMap((s) => (Array.isArray(s?.tactics) ? s.tactics : [])))].filter((id) => leadById.has(id))
  const recentAngles = [...new Set(sessions.flatMap((s) => (Array.isArray(s?.angles) ? s.angles : [])))].filter((a) => typeof a === 'string' && a.trim()).slice(0, 6)
  const ceiling = mem.registerCeiling

  if (!recentLead.length && !recentAngles.length && ceiling !== 'peer') return ''

  const who = staffName || 'this clinician'
  const parts = [`ALREADY COVERED WITH ${who} — build on the relationship, don't re-run it.`]
  if (recentLead.length) parts.push(`Opening/lead tactics you've recently used: ${recentLead.map((id) => leadById.get(id)).join(', ')}. Reach for DIFFERENT lead tactics this time.`)
  if (recentAngles.length) parts.push(`Angles already dug into: ${recentAngles.join('; ')}. Find fresh ground rather than re-covering these.`)
  if (ceiling === 'peer') parts.push('This clinician consistently goes deep and technical — you can open at peer level instead of warming up from scratch.')
  return `\n${parts.join(' ')}\n`
}
