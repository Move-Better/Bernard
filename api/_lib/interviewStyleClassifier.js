// Phase 2 (evolving interviewer) — post-interview style classifier.
//
// On interview completion, labels which LEAD tactics / clinical angles / register
// the interview used and merges them into staff.interview_style_memory. The next
// interview's prompt reads that ledger (buildStyleMemoryBlock in
// src/lib/interviewTactics.js) and deliberately reaches for different lead tactics —
// so the interviewer evolves per clinician instead of re-running the same
// conversation.
//
// Runs fire-and-forget via waitUntil() from the interview-completion PATCH
// (api/_routes/db/interviews.js). Best-effort: any failure logs
// [interviewStyleClassifier] and leaves the ledger untouched (the interview is
// unaffected). Reads + writes are always scoped to (staffId, workspaceId) so a
// misrouted call can never touch another tenant's row.

import { generateText } from 'ai'
import { INTERVIEW_TACTICS, isTacticId, LEAD_TACTICS } from '../../src/lib/interviewTactics.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL = 'anthropic/claude-sonnet-4-6'
const MODEL_TIMEOUT_MS = 60_000
const MAX_SESSIONS = 3

const REGISTERS = new Set(['lay', 'mid', 'peer'])
const RANK = { lay: 0, mid: 1, peer: 2 }
const LEAD_IDS = new Set(LEAD_TACTICS.map((t) => t.id))

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function buildTranscript(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === 'assistant' && typeof m?.content === 'string')
    .map((m, i) => `Q${i + 1}: ${m.content}`)
    .join('\n\n')
    .slice(0, 12000)
}

export async function classifyAndStoreInterviewStyle({ workspaceId, staffId, interviewId, messages }) {
  if (!staffId || !workspaceId) return
  if (!SUPABASE_URL || !SUPABASE_KEY || !process.env.AI_GATEWAY_API_KEY) return
  const transcript = buildTranscript(messages)
  if (transcript.length < 80) return // too short to classify usefully

  const sys = `You label an interviewer's questions from a clinical content interview.

TACTICS:
${INTERVIEW_TACTICS.map((t) => `${t.id}: ${t.desc}`).join('\n')}

Also judge the interviewer's REGISTER — how technical the questions got overall: "lay" (plain language), "mid" (some clinical), or "peer" (full peer-to-peer clinical shop talk with real anatomy/mechanism).

Return ONLY minified JSON, no prose, no code fences:
{"tactics":["id",...],"angles":["3-6 word clinical thread",...],"register":"lay|mid|peer"}
- "tactics": the tactic ids the interviewer actually used (ids from the list above).
- "angles": the distinct clinical threads pursued (max 6, short).`

  let parsed
  try {
    const { text } = await generateText({
      model: MODEL,
      system: sys,
      messages: [{ role: 'user', content: transcript }],
      maxOutputTokens: 300,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    })
    parsed = JSON.parse(String(text || '').replace(/```json|```/g, '').trim())
  } catch (e) {
    console.error('[interviewStyleClassifier] classify failed:', e?.message)
    return
  }

  const rawTactics = Array.isArray(parsed?.tactics) ? parsed.tactics.filter(isTacticId) : []
  const leadTactics = rawTactics.filter((id) => LEAD_IDS.has(id))
  const angles = Array.isArray(parsed?.angles)
    ? parsed.angles.filter((a) => typeof a === 'string' && a.trim()).map((a) => a.trim().slice(0, 80)).slice(0, 6)
    : []
  const register = REGISTERS.has(parsed?.register) ? parsed.register : 'mid'

  try {
    const readRes = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${workspaceId}&select=interview_style_memory`)
    if (!readRes.ok) { console.error('[interviewStyleClassifier] read failed:', readRes.status); return }
    const rows = await readRes.json()
    if (!Array.isArray(rows) || !rows.length) return // staff not in this workspace — never cross-tenant write
    const prev = (rows[0].interview_style_memory && typeof rows[0].interview_style_memory === 'object') ? rows[0].interview_style_memory : {}
    const prevSessions = Array.isArray(prev.sessions) ? prev.sessions : []
    const sessions = [...prevSessions, { interviewId, tactics: leadTactics, angles, register, at: new Date().toISOString() }].slice(-MAX_SESSIONS)
    const registerCeiling = [prev.registerCeiling, register].filter((r) => REGISTERS.has(r)).reduce((hi, r) => (RANK[r] > RANK[hi] ? r : hi), 'lay')
    const next = { sessions, registerCeiling, sessionCount: (Number(prev.sessionCount) || 0) + 1 }

    const patchRes = await sb(`staff?id=eq.${staffId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ interview_style_memory: next }),
    })
    if (!patchRes.ok) console.error('[interviewStyleClassifier] patch failed:', patchRes.status)
  } catch (e) {
    console.error('[interviewStyleClassifier] store failed:', e?.message)
  }
}
