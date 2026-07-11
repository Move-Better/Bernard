// api/_lib/scoreAnswerFidelity.js
//
// Voice-fidelity scorer for PUBLIC answers (F16 Phase 1) — the Q&A sibling of
// captionFidelity.js. Scores an answer (lead + body) against the owning
// clinician's captured voice + their OWN topic-scoped practice memory (the gold
// reference), using the shared rubric (answerFidelityRubric.js — single source of
// truth). Returns the result; the CALLER persists voice_fidelity_score + voice_audit.
//
// Reusable at two points:
//   • draft time (draftAnswer.js) — passes its already-fetched grounding so we
//     don't run the topic RAG twice.
//   • approve time (answers.js) — the authoritative HARD GATE; lets the scorer
//     fetch fresh grounding and judges the exact text about to publish.
//
// Never throws: every failure path returns { ok:false, reason } so callers can
// fail closed (a public answer that can't be verified must not publish).

import { generateText } from 'ai'
import { buildAnswerFidelityPrompt, parseAnswerFidelity } from './answerFidelityRubric.js'
import { buildTopicScopedHistoryBlock } from './practiceMemory.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const EVAL_MODEL   = 'anthropic/claude-haiku-4-5'

// The HARD publish bar (1–10 overall). Below this a public answer is 'held' and
// the approve->publish transition is blocked at the API layer. Single source of
// truth — imported by answers.js. Q set 7.5 (stricter than the content soft bar
// of 6.5) for name-on-it public medical content. See F16 design interview.
export const ANSWER_GATE = 7.5

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

// Resolve the grounding the judge scores against: the clinician's name + voice
// notes + top phrases, and their own captured thinking on this topic. Mirrors
// draftAnswer.js's fetch so draft-time and approve-time judge against the same
// signals. Best-effort — a failure just means neutral dims, never a throw.
export async function fetchAnswerGrounding({ ws, staffId, question, condition }) {
  const g = { staffName: 'this clinician', voiceNotes: '', voicePhrases: [], historyBlock: '' }
  if (!ws?.id) return g
  const wsFilter = `workspace_id=eq.${ws.id}`
  try {
    const fetches = [
      buildTopicScopedHistoryBlock({
        topic: `${question} ${condition || ''}`.trim(),
        workspaceId: ws.id,
        staffId: staffId || null,
        k: 6,
      }).then((b) => { g.historyBlock = b || '' }).catch(() => {}),
    ]
    if (staffId) {
      fetches.push(
        sb(`staff?id=eq.${staffId}&${wsFilter}&select=name,voice_notes`).then(async (r) => {
          if (!r.ok) return
          const row = (await r.json())[0]
          if (row) { g.staffName = row.name || g.staffName; g.voiceNotes = row.voice_notes || '' }
        }).catch(() => {}),
        sb(`staff_voice_phrases?staff_id=eq.${staffId}&${wsFilter}&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`)
          .then(async (r) => { if (r.ok) g.voicePhrases = (await r.json()) || [] }).catch(() => {}),
      )
    }
    await Promise.all(fetches)
  } catch {
    // keep whatever we got
  }
  return g
}

function workspaceName(ws) {
  return ws?.display_name || ws?.name || ws?.slug || 'the practice'
}

/**
 * Score one answer's voice fidelity. Pure of persistence.
 *
 * @param {object}  a
 * @param {object}  a.ws          resolved workspace ({ id, display_name|name|slug })
 * @param {string}  a.staffId     owning clinician staff.id
 * @param {string}  a.question
 * @param {string} [a.condition]
 * @param {string}  a.answerLead
 * @param {string} [a.body]
 * @param {object} [a.grounding]  optional pre-fetched { staffName, voiceNotes, voicePhrases, historyBlock }
 * @returns {Promise<{ok:true, overall:number, score100:number, gate:'passed'|'held', breakdown:object, voiceAudit:object}
 *                   | {ok:false, reason:string}>}
 */
export async function scoreAnswerFidelity({ ws, staffId, question, condition, answerLead, body = '', grounding }) {
  if (!ws?.id || !question) return { ok: false, reason: 'missing_ids' }
  if (!process.env.AI_GATEWAY_API_KEY) return { ok: false, reason: 'no_ai_key' }
  if (!`${answerLead || ''} ${body || ''}`.trim()) return { ok: false, reason: 'empty' }

  const g = grounding || (await fetchAnswerGrounding({ ws, staffId, question, condition }))

  const prompt = buildAnswerFidelityPrompt({
    question, condition, answerLead, body,
    reference: g.historyBlock, phrases: g.voicePhrases, voiceNotes: g.voiceNotes,
    staffName: g.staffName, workspaceName: workspaceName(ws),
  })

  let raw = ''
  try {
    const res = await generateText({
      model: EVAL_MODEL,
      instructions: prompt.instructions,
      messages: [{ role: 'user', content: prompt.user }],
      maxOutputTokens: 300,
    })
    raw = res.text
  } catch (err) {
    console.error('[scoreAnswerFidelity] LLM call failed:', err?.message || err)
    return { ok: false, reason: 'llm_error' }
  }

  const parsed = parseAnswerFidelity(raw, {
    has_reference: !!(g.historyBlock || '').trim(),
    has_voice:     !!((g.voiceNotes || '').trim() || (g.voicePhrases || []).length),
    model:         EVAL_MODEL,
    rubric:        'answer-fidelity-v1',
    scored_at:     new Date().toISOString(),
  })
  if (!parsed) return { ok: false, reason: 'no_dims_parsed' }

  const { overall, breakdown } = parsed
  const gate = overall >= ANSWER_GATE ? 'passed' : 'held'
  const voiceAudit = { ...breakdown, gate, threshold: ANSWER_GATE }
  return { ok: true, overall, score100: Math.round(overall * 10), gate, breakdown, voiceAudit }
}
