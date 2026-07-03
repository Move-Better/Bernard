// The Standing Producer's revision agent (Phase 1).
//
// Given a change-request comment on a content_item, Bernard revises the draft
// to address it — grounded exactly like the original draft (the clinician's
// transcript + practice-brain retrieval + voice phrases + brand), re-judged
// with the same voice-fidelity rubric — then PATCHes the content and posts a
// reply in the comment thread explaining what changed and returns it to review.
//
// Called by the agent-tick cron per claimed 'revise_content_item' inbox item.
// Returns a structured result; THROWS on transient failure so the tick can
// retry. The human approval gate is untouched: this only moves a piece
// draft→in_review, never to approved/scheduled/published.

import { generateText } from 'ai'
import { getContextBlock } from '../conceptRetrieval.js'
import { resolveOwnHistoryBlock, buildRagQuery } from '../practiceMemory.js'
import { buildFidelityPrompt, parseFidelity } from '../captionFidelityRubric.js'
import { recordAgentAction } from '../agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const REVISE_MODEL = 'anthropic/claude-sonnet-4-6'
const JUDGE_MODEL  = 'anthropic/claude-haiku-4-5'

// Bernard's synthetic comment identity (won't resolve via Clerk; the thread UI
// special-cases it). Keep in sync with the AssetsPane render.
const PRODUCER_USER_ID = 'bernard-producer'
const PRODUCER_EMAIL   = 'producer@withbernard.ai'

// Only these statuses are revisable — a piece the human already re-approved,
// scheduled, or published is off-limits (cooperative cancel).
const REVISABLE = new Set(['draft', 'in_review'])

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

// The model returns the full revised post, then this delimiter, then a
// one-sentence summary — a plain-text split (draft.js's ---SLIDES--- pattern),
// which is far more robust for long text fields than structured-object output
// (generateObject truncates long string values).
const CHANGE_DELIM = '---WHAT-I-CHANGED---'

function buildRevisionPrompt({ ws, staffName, platform, voiceNotes, voicePhrases, brandBlock, ownHistoryBlock }) {
  const phraseLines = (voicePhrases || []).slice(0, 8).map((p) => `- "${p.phrase}"`).join('\n')
  const system = [
    `You are Bernard, the content producer for ${staffName || 'the clinician'} at ${ws.display_name || ws.slug || 'the practice'}.`,
    `You are revising a ${platform} post to address a reviewer's change request.`,
    '',
    'Hard rules:',
    '- Address the change request directly.',
    '- Stay faithful to what the clinician ACTUALLY said — never invent claims, statistics, or specifics beyond the transcript.',
    "- Keep it in the clinician's own voice and register (clinical or personal — whatever they used); do not professionalize or smooth it out.",
    '- Preserve anything the reviewer did not ask you to change.',
    '',
    `Output format: the full revised post, then a line containing exactly ${CHANGE_DELIM}, then one first-person sentence summarizing what you changed. Nothing else — no preamble, no labels.`,
    voiceNotes ? `\nVoice notes for ${staffName}:\n${voiceNotes}` : '',
    phraseLines ? `\nHow ${staffName} tends to phrase things (match the rhythm, don't parrot):\n${phraseLines}` : '',
    brandBlock ? `\nBrand guidelines:\n${brandBlock}` : '',
    ownHistoryBlock ? `\n${ownHistoryBlock}` : '',
  ].filter(Boolean).join('\n')
  return system
}

/**
 * Revise one content_item to address a change request.
 * @param {object} a
 * @param {object} a.ws                 workspace row (must include producer_config)
 * @param {string} a.contentItemId
 * @param {string} a.changeRequest      the reviewer's change-request text
 * @param {string} [a.commentId]        the source comment id (for the ledger)
 * @param {string} [a.inboxItemId]
 * @returns {Promise<{status:'revised'|'skipped', reason?:string, score?:number}>}
 */
export async function reviseContentItem({ ws, contentItemId, changeRequest, commentId, inboxItemId }) {
  const wsId = ws.id
  const wsFilter = `workspace_id=eq.${wsId}`

  // Fetch the piece.
  const pieceRes = await sb(
    `content_items?id=eq.${contentItemId}&${wsFilter}` +
    `&select=id,status,content,platform,topic,interview_id,staff_id,updated_at&limit=1`
  )
  if (!pieceRes.ok) throw new Error(`piece fetch ${pieceRes.status}`)
  const piece = (await pieceRes.json())?.[0]
  if (!piece) return { status: 'skipped', reason: 'piece_not_found' }
  if (!REVISABLE.has(piece.status)) return { status: 'skipped', reason: `not_revisable_status:${piece.status}` }
  if (!piece.content || !piece.content.trim()) return { status: 'skipped', reason: 'empty_content' }

  // Ground exactly like draft.js: transcript (primary), voice substrate, concept
  // block, and the clinician's own prior thinking (RAG). All best-effort — a
  // missing interview just means a lighter-grounded revision, not a failure.
  let interview = null
  if (piece.interview_id) {
    const ivRes = await sb(
      `interviews?id=eq.${piece.interview_id}&${wsFilter}` +
      `&select=id,topic,tone,voice_mode,staff_id,messages,audience,story_type&limit=1`
    )
    if (ivRes.ok) interview = (await ivRes.json())?.[0] || null
  }
  const staffId = piece.staff_id || interview?.staff_id || null
  const turns = Array.isArray(interview?.messages) ? interview.messages : []
  const clinicianSaid = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .join('\n\n')
    .slice(0, 2500)

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
    ? await resolveOwnHistoryBlock({
        workspaceId: wsId,
        staffId,
        excludeInterviewId: interview.id,
        query: buildRagQuery(interview),
      }).catch(() => '')
    : ''

  const brandBlock = (ws.brand_guidelines || '') + (conceptBlock || '')
  const system = buildRevisionPrompt({
    ws, staffName, platform: piece.platform,
    voiceNotes, voicePhrases, brandBlock, ownHistoryBlock,
  })

  const userMsg = [
    'CURRENT DRAFT:',
    '"""', piece.content.trim(), '"""',
    '',
    clinicianSaid
      ? `WHAT THE CLINICIAN ACTUALLY SAID (the source of truth — stay faithful to this):\n"""\n${clinicianSaid}\n"""`
      : '(No transcript on record for this piece — revise the copy without inventing new claims.)',
    '',
    "REVIEWER'S CHANGE REQUEST:",
    '"""', String(changeRequest || '').slice(0, 1500).trim(), '"""',
    '',
    'Revise the draft to address the change request. Return the revised post and a one-sentence summary of what you changed.',
  ].join('\n')

  // Revise (Sonnet). Plain text → split on the delimiter for the reply summary.
  const { text: raw } = await generateText({
    model: REVISE_MODEL,
    instructions: system,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 1500,
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(90_000),
  })
  const [revisedRaw, summaryRaw] = String(raw || '').split(CHANGE_DELIM)
  const revised = (revisedRaw || '').trim()
  const summary = (summaryRaw || '').trim()
  if (!revised) return { status: 'skipped', reason: 'empty_revision' }

  // Re-judge with the SAME rubric draft.js uses (used correctly here:
  // `instructions` is the system half — draft.js reads `.system`, which is
  // undefined, so its judge runs without the preamble; flagged as a follow-up).
  let score = null
  let audit = null
  try {
    const ep = buildFidelityPrompt({
      topic: piece.topic || '',
      caption: revised,
      transcript: clinicianSaid,
      phrases: voicePhrases,
      staffName,
      workspaceName: ws.display_name || ws.slug || 'practice',
    })
    const { text: judgeRaw } = await generateText({
      model: JUDGE_MODEL,
      instructions: ep.instructions,
      messages: [{ role: 'user', content: ep.user }],
      // 400 (not draft.js's 240): a verbose red_flag can overrun 240 and
      // truncate the JSON → parseFidelity returns null (no score). Headroom here.
      maxOutputTokens: 400,
      abortSignal: AbortSignal.timeout(60_000),
    })
    const parsed = parseFidelity(judgeRaw, { model: JUDGE_MODEL, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(), source: 'revision' })
    if (parsed) { score = Math.round(parsed.overall * 10); audit = { ...parsed.breakdown, revised_by: 'bernard-producer' } }
  } catch (e) {
    console.warn('[reviseContentItem] judge failed:', e?.message)
  }

  // Persist the revision — GUARDED on status so a piece the human re-approved
  // between claim and now is never clobbered. ai_original_content is left as the
  // pristine baseline. Returns to in_review for the human to re-review.
  const patchBody = { content: revised, status: 'in_review', updated_at: new Date().toISOString() }
  if (score !== null) { patchBody.voice_fidelity_score = score; patchBody.voice_audit = audit }
  const patchRes = await sb(
    `content_items?id=eq.${contentItemId}&${wsFilter}&status=in.(draft,in_review)`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patchBody) }
  )
  if (!patchRes.ok) throw new Error(`content patch ${patchRes.status}`)
  const patched = await patchRes.json().catch(() => [])
  if (!Array.isArray(patched) || patched.length === 0) {
    // The piece moved out of a revisable state after we claimed it — cooperative
    // cancel: don't post a reply, don't retry.
    return { status: 'skipped', reason: 'status_changed_during_revision' }
  }

  // Post Bernard's reply in the thread. Score appended programmatically so the
  // number is always the real one, not the model's self-report.
  const replyBody = [
    summary || 'Revised the draft to address your change request.',
    score !== null ? `Voice score ${score}/100 — back for your review.` : 'Back for your review.',
  ].join(' ')
  await sb('content_item_comments', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      workspace_id: wsId,
      content_item_id: contentItemId,
      user_id: PRODUCER_USER_ID,
      user_email: PRODUCER_EMAIL,
      body: replyBody,
      kind: 'comment',
    }),
  }).catch((e) => console.warn('[reviseContentItem] reply post failed:', e?.message))

  // Workday ledger.
  await recordAgentAction({
    workspaceId: wsId,
    producerConfig: ws.producer_config,
    kind: 'revision',
    title: `Revised "${(piece.topic || 'a piece').slice(0, 60)}" per your change request${score !== null ? ` — voice ${score}/100` : ''}`,
    detail: { platform: piece.platform, score, change_request: String(changeRequest || '').slice(0, 200) },
    contentItemId,
    interviewId: piece.interview_id || null,
    inboxItemId: inboxItemId || null,
    model: REVISE_MODEL,
  })

  return { status: 'revised', score, commentId }
}
