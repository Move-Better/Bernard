// The Standing Producer's voice-repair agent (Phase 2A.2).
//
// When a SHORT caption is drafted below the voice bar (draft.js already tried
// one soft regenerate, then marked voice_audit.gate='held'), the producer takes
// ONE more, differently-strategized pass focused purely on faithfulness — fix
// the flagged drift, stay verbatim-close to the transcript — and re-judges:
//   - passes (>= GATE) → swap in the tighter caption, clear the hold, reply in
//     the thread, return the piece to review.
//   - still below → escalate: keep the original, mark it escalated (still held
//     so /week keeps flagging it) and leave a note; the human takes it from here.
//
// One-shot per piece (guarded on voice_audit.producer_attempts), so a caption
// the rubric simply can't lift never loops. Grounded exactly like the draft /
// revision paths. Called by agent-tick per claimed 'judge_low_score' inbox item.
// Human approval gate untouched — this only ever leaves the piece a 'draft'.

import { generateText } from 'ai'
import { getContextBlock } from '../conceptRetrieval.js'
import { resolveOwnHistoryBlock, buildRagQuery } from '../practiceMemory.js'
import { buildFidelityPrompt, parseFidelity } from '../captionFidelityRubric.js'
import { recordAgentAction } from '../agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const REGEN_MODEL = 'anthropic/claude-sonnet-4-6'
const JUDGE_MODEL = 'anthropic/claude-haiku-4-5'
const GATE = 6.5
const TRANSCRIPT_MAX = 24_000

const PRODUCER_USER_ID = 'bernard-producer'
const PRODUCER_EMAIL   = 'producer@withbernard.ai'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function postProducerComment(wsId, contentItemId, body) {
  await sb('content_item_comments', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      workspace_id: wsId, content_item_id: contentItemId,
      user_id: PRODUCER_USER_ID, user_email: PRODUCER_EMAIL,
      body, kind: 'comment',
    }),
  }).catch((e) => console.warn('[regradeContentItem] comment failed:', e?.message))
}

/**
 * @param {object} a
 * @param {object} a.ws              workspace row (must include producer_config)
 * @param {string} a.contentItemId
 * @param {string} [a.redFlag]       the voice-drift red_flag from the draft judge
 * @param {string} [a.inboxItemId]
 * @returns {Promise<{status:'passed'|'escalated'|'skipped', reason?:string, score?:number}>}
 */
export async function regradeContentItem({ ws, contentItemId, redFlag, inboxItemId }) {
  const wsId = ws.id
  const wsFilter = `workspace_id=eq.${wsId}`

  const pieceRes = await sb(
    `content_items?id=eq.${contentItemId}&${wsFilter}` +
    `&select=id,status,content,platform,topic,interview_id,staff_id,voice_audit&limit=1`
  )
  if (!pieceRes.ok) throw new Error(`piece fetch ${pieceRes.status}`)
  const piece = (await pieceRes.json())?.[0]
  if (!piece) return { status: 'skipped', reason: 'piece_not_found' }
  // Cooperative cancel: only an un-acted, still-held draft is eligible.
  if (piece.status !== 'draft') return { status: 'skipped', reason: `not_draft:${piece.status}` }
  const audit = piece.voice_audit && typeof piece.voice_audit === 'object' ? piece.voice_audit : {}
  if (audit.gate !== 'held') return { status: 'skipped', reason: 'not_held' }
  if (audit.producer_attempts) return { status: 'skipped', reason: 'already_attempted' }
  if (!piece.content || !piece.content.trim()) return { status: 'skipped', reason: 'empty_content' }
  const flag = redFlag || audit.red_flag || 'voice drift from the transcript'

  // Ground exactly like the draft / revision paths (best-effort).
  let interview = null
  if (piece.interview_id) {
    const ivRes = await sb(
      `interviews?id=eq.${piece.interview_id}&${wsFilter}&select=id,topic,messages&limit=1`
    )
    if (ivRes.ok) interview = (await ivRes.json())?.[0] || null
  }
  const staffId = piece.staff_id || interview?.staff_id || null
  const turns = Array.isArray(interview?.messages) ? interview.messages : []
  const clinicianSaid = turns
    .filter((t) => t.role === 'user').map((t) => t.content).join('\n\n').slice(0, TRANSCRIPT_MAX)

  let staffName = ''
  let voiceNotes = ''
  let voicePhrases = []
  if (staffId) {
    const [clinRes, phrasesRes] = await Promise.all([
      sb(`staff?id=eq.${staffId}&${wsFilter}&select=name,voice_notes&limit=1`),
      sb(`staff_voice_phrases?staff_id=eq.${staffId}&${wsFilter}&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`),
    ])
    if (clinRes.ok) { const r = (await clinRes.json())?.[0]; staffName = r?.name || ''; voiceNotes = r?.voice_notes || '' }
    if (phrasesRes.ok) voicePhrases = (await phrasesRes.json()) || []
  }
  const conceptBlock = await getContextBlock({ workspaceId: wsId, topic: piece.topic || interview?.topic }).catch(() => '')
  const ownHistoryBlock = (staffId && interview)
    ? await resolveOwnHistoryBlock({ workspaceId: wsId, staffId, excludeInterviewId: interview.id, query: buildRagQuery(interview) }).catch(() => '')
    : ''
  const brandBlock = (ws.brand_guidelines || '') + (conceptBlock || '')
  const phraseLines = voicePhrases.slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')

  // Faithfulness-repair prompt — deliberately stricter than the draft's generic
  // coached retry: this pass is ONLY about matching what was actually said.
  const system = [
    `You are Bernard, the content producer for ${staffName || 'the clinician'} at ${ws.display_name || ws.slug || 'the practice'}.`,
    `A ${piece.platform} caption you drafted was flagged for VOICE DRIFT: "${flag}".`,
    'Rewrite it as a FAITHFULNESS pass, not a style pass:',
    '- Stay verbatim-close to what the clinician actually said — use their words, phrasing, and register.',
    '- Do NOT invent claims, numbers, framing, or clinical terms they did not use.',
    '- Do NOT professionalize or smooth it out; warm/personal is fine if that is how they spoke.',
    '- Keep it tight — every line should trace to the transcript.',
    'Return ONLY the revised caption. No preamble, no labels, no explanation.',
    voiceNotes ? `\nVoice notes for ${staffName}:\n${voiceNotes}` : '',
    phraseLines ? `\nHow ${staffName} tends to phrase things (match the rhythm, don't parrot):\n${phraseLines}` : '',
    brandBlock ? `\nBrand guidelines:\n${brandBlock}` : '',
    ownHistoryBlock ? `\n${ownHistoryBlock}` : '',
  ].filter(Boolean).join('\n')

  const userMsg = [
    'CURRENT CAPTION (flagged for voice drift):',
    '"""', piece.content.trim(), '"""',
    '',
    clinicianSaid
      ? `WHAT THE CLINICIAN ACTUALLY SAID (the source of truth):\n"""\n${clinicianSaid}\n"""`
      : '(No transcript on record — tighten toward their known voice without inventing claims.)',
    '',
    'Rewrite the caption to fix the voice drift and stay faithful.',
  ].join('\n')

  const { text } = await generateText({
    model: REGEN_MODEL, instructions: system,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 1000, maxRetries: 2, abortSignal: AbortSignal.timeout(90_000),
  })
  const revised = (text || '').trim()

  // Re-judge the rewrite against the full transcript.
  let newScore = null
  let breakdown = null
  if (revised) {
    try {
      const ep = buildFidelityPrompt({
        topic: piece.topic || '', caption: revised, transcript: clinicianSaid,
        phrases: voicePhrases, staffName, workspaceName: ws.display_name || ws.slug || 'practice',
      })
      const { text: judgeRaw } = await generateText({
        model: JUDGE_MODEL, instructions: ep.instructions,
        messages: [{ role: 'user', content: ep.user }],
        maxOutputTokens: 400, abortSignal: AbortSignal.timeout(60_000),
      })
      const parsed = parseFidelity(judgeRaw, { model: JUDGE_MODEL, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(), source: 'regrade' })
      if (parsed) { newScore = parsed.overall; breakdown = parsed.breakdown }
    } catch (e) {
      console.warn('[regradeContentItem] judge failed:', e?.message)
    }
  }

  const scored100 = newScore !== null ? Math.round(newScore * 10) : null

  if (revised && newScore !== null && newScore >= GATE) {
    // PASS — swap in the tighter caption + clear the hold. Guarded (cooperative
    // cancel): only if it's still the held draft we claimed.
    const patchRes = await sb(
      `content_items?id=eq.${contentItemId}&${wsFilter}&status=eq.draft`,
      {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          content: revised,
          voice_fidelity_score: scored100,
          voice_audit: { ...breakdown, gate: 'passed', producer_attempts: 1, regraded_by: PRODUCER_USER_ID },
          updated_at: new Date().toISOString(),
        }),
      }
    )
    if (!patchRes.ok) throw new Error(`content patch ${patchRes.status}`)
    const patched = await patchRes.json().catch(() => [])
    if (!Array.isArray(patched) || patched.length === 0) {
      return { status: 'skipped', reason: 'status_changed_during_regrade' }
    }
    await postProducerComment(wsId, contentItemId,
      `The first draft drifted from your voice (${flag}). I tightened it back to what you actually said — it clears the voice check now. Back for your review.`)
    await recordAgentAction({
      workspaceId: wsId, producerConfig: ws.producer_config, kind: 'revision',
      title: `Tightened "${(piece.topic || 'a caption').slice(0, 60)}" to pass the voice check`,
      detail: { platform: piece.platform, score: scored100, fixed_flag: String(flag).slice(0, 160) },
      contentItemId, interviewId: piece.interview_id || null, inboxItemId: inboxItemId || null, model: REGEN_MODEL,
    })
    return { status: 'passed', score: scored100 }
  }

  // STILL below the bar (or the rewrite/judge failed) — escalate. Keep the
  // original content (don't swap in a still-failing rewrite); keep gate='held'
  // so /week keeps flagging it; mark it escalated + attempted so it never loops.
  // Throw on write failure (like the pass branch) so the tick retries rather
  // than the ledger/comment claiming an escalation the row never recorded.
  const escRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}&status=eq.draft`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      voice_audit: { ...audit, gate: 'held', producer_attempts: 1, escalated: true, red_flag: flag },
      updated_at: new Date().toISOString(),
    }),
  })
  if (!escRes.ok) throw new Error(`escalate patch ${escRes.status}`)
  await postProducerComment(wsId, contentItemId,
    `I tried to tighten this back to your voice but couldn't get it over the bar — it needs your eye. What's off: ${flag}.`)
  await recordAgentAction({
    workspaceId: wsId, producerConfig: ws.producer_config, kind: 'escalation',
    title: `Couldn't fix the voice on "${(piece.topic || 'a caption').slice(0, 60)}" — needs you`,
    detail: { platform: piece.platform, best_score: scored100, red_flag: String(flag).slice(0, 160) },
    contentItemId, interviewId: piece.interview_id || null, inboxItemId: inboxItemId || null, model: REGEN_MODEL,
  })
  return { status: 'escalated', score: scored100 }
}
