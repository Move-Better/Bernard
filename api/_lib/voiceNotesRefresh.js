// Voice-notes refresh — the edit-learning loop's one implementation.
//
// Distills how a clinician edits AI drafts into a short "voice notes" block
// that is injected into every future prompt for their content (see
// src/lib/prompts.js). Reads recent content_items where ai_original_content
// !== content, asks a model to name the repeated patterns, saves to
// staff.voice_notes.
//
// Extracted from api/_routes/staff/refresh-voice-notes.js (2026-08-29) so the
// manual profile button and the automatic on-approve trigger run the SAME
// code. This repo's recurring bug class is two copies of one primitive drifting
// apart (see CLAUDE.md "Buffer vs bundle.social publish paths" and the
// captionFidelityRubric/answerFidelityRubric split) — one copy, on purpose.
//
// Why it needed wiring at all: the analyzer shipped as a manual button and, as
// of 2026-08-29, had NEVER RUN — 0 of 20 staff had voice notes — while 15 of 21
// movebetter blogs had been genuinely edited before approval. Real teaching
// signal was being captured and discarded (Q's call to wire it).

import { generateText } from 'ai'

const MAX_PAIRS = 12       // most recent edit pairs to analyze
const MIN_PAIRS = 3        // minimum needed before we even try

// Don't re-analyze on every approve. The analyzer costs one model call and
// reads the trailing 40 items, so a clinician approving several pieces in a
// sitting would otherwise burn a call each for a near-identical corpus. A
// week's cooldown keeps the notes fresh without paying per approve; the manual
// profile button bypasses it (force) so a clinician can always refresh now.
export const VOICE_NOTES_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Is a refresh due for this staff row?
 *
 * Pure and total so the cadence rule is unit-testable and can't drift between
 * the button and the approve path.
 *
 * @param {{voice_notes_refreshed_at?: string|null}|null|undefined} staffRow
 * @param {number} nowMs
 * @param {number} [cooldownMs]
 * @returns {boolean}
 */
export function shouldRefreshVoiceNotes(staffRow, nowMs, cooldownMs = VOICE_NOTES_COOLDOWN_MS) {
  if (!staffRow) return false
  const last = staffRow.voice_notes_refreshed_at
  if (!last) return true            // never run — the 0-of-20 case
  const lastMs = Date.parse(last)
  if (Number.isNaN(lastMs)) return true   // unreadable stamp → treat as stale
  return nowMs - lastMs >= cooldownMs
}

/**
 * Build the analysis prompt. Exported for testing.
 * @param {string} staffName
 * @param {string} workspaceName
 * @param {Array<{platform:string, topic:string, ai_original_content:string, content:string}>} editPairs
 */
export function buildAnalysisPrompt(staffName, workspaceName, editPairs) {
  const examples = editPairs
    .map((p, i) => `### EXAMPLE ${i + 1} — ${p.platform} post on ${p.topic}

AI ORIGINAL:
${p.ai_original_content}

WHAT ${String(staffName || '').toUpperCase()} CHANGED IT TO:
${p.content}
`)
    .join('\n')

  return `You are analyzing how a clinician at ${workspaceName} edits AI-generated content drafts. Identify the consistent patterns in how they revise drafts — things they routinely cut, add, rephrase, or restructure.

Your output will be injected directly into future prompts as guidance, so:
- Write actionable rules, not observations ("Cut hedging phrases like 'we believe'" — not "Tends to remove hedging phrases")
- 3 to 6 bullet points, one short line each
- Skip anything that only happened once or twice — only include patterns you see repeated across multiple examples
- Skip generic writing advice ("be specific," "use active voice") — only call out patterns SPECIFIC to this clinician's voice
- Skip stylistic preferences too vague to act on ("more conversational tone")
- If there are not enough consistent patterns to be useful, return the single line: "NO CLEAR PATTERN"

OUTPUT FORMAT — your full response must be just the bulleted rules, nothing else. No preamble, no commentary, no markdown headers.

EDIT EXAMPLES:

${examples}

Now write the rules.`
}

/**
 * Select the usable edit pairs from a batch of content_items rows.
 * Exported so the "what counts as an edit" rule is testable on its own.
 * @param {Array<object>} items
 */
export function selectEditPairs(items) {
  if (!Array.isArray(items)) return []
  return items
    .filter((it) =>
      it &&
      it.ai_original_content &&
      it.content &&
      String(it.ai_original_content).trim() !== String(it.content).trim()
    )
    .slice(0, MAX_PAIRS)
}

/**
 * Run the refresh for one clinician.
 *
 * Never throws — every caller treats this as best-effort enrichment (the manual
 * route maps the result to its own HTTP response; the approve path fires it
 * through waitUntil and must never fail an approve because learning failed).
 *
 * @param {object}   args
 * @param {Function} args.sb            workspace-scoped supabaseRest-style fetch
 * @param {string}   args.staffId
 * @param {string}   args.wsFilter      e.g. `workspace_id=eq.<id>`
 * @param {string}   args.workspaceName
 * @param {boolean} [args.force]        skip the cooldown (manual button)
 * @param {number}  [args.nowMs]
 * @returns {Promise<{ok:boolean, reason?:string, edits_analyzed?:number, voice_notes?:string|null}>}
 */
export async function refreshVoiceNotes({ sb, staffId, wsFilter, workspaceName, force = false, nowMs = Date.now() }) {
  try {
    const clinRes = await sb(`staff?id=eq.${staffId}&${wsFilter}&select=id,name,user_id,voice_notes_refreshed_at`)
    if (!clinRes.ok) return { ok: false, reason: 'staff_lookup_failed' }
    const [staffMember] = await clinRes.json()
    if (!staffMember) return { ok: false, reason: 'staff_not_found' }

    if (!force && !shouldRefreshVoiceNotes(staffMember, nowMs)) {
      return { ok: true, reason: 'cooldown' }
    }

    const itemsRes = await sb(
      `content_items?staff_id=eq.${staffId}&${wsFilter}` +
      `&select=platform,topic,content,ai_original_content` +
      `&ai_original_content=not.is.null` +
      `&order=created_at.desc&limit=40`
    )
    if (!itemsRes.ok) return { ok: false, reason: 'items_lookup_failed' }
    const editPairs = selectEditPairs(await itemsRes.json())

    if (editPairs.length < MIN_PAIRS) {
      // Save a marker so the UI shows "need more edits" rather than looking broken.
      await sb(`staff?id=eq.${staffId}&${wsFilter}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          voice_notes: null,
          voice_notes_refreshed_at: new Date(nowMs).toISOString(),
          voice_notes_edits_analyzed: editPairs.length,
        }),
      })
      return {
        ok: true,
        reason: 'insufficient_pairs',
        edits_analyzed: editPairs.length,
        voice_notes: null,
        pairs_required: MIN_PAIRS,
      }
    }

    let analysisText
    try {
      const result = await generateText({
        model: 'anthropic/claude-sonnet-4-6',
        instructions: buildAnalysisPrompt(staffMember.name, workspaceName, editPairs),
        messages: [{ role: 'user', content: 'Analyze the edits and write the rules now.' }],
        maxOutputTokens: 600,
      })
      analysisText = (result.text || '').trim()
    } catch (e) {
      console.error('[voiceNotesRefresh] AI call failed:', e?.message)
      return { ok: false, reason: 'ai_analysis_failed' }
    }

    // "NO CLEAR PATTERN" means the model found nothing actionable.
    const voiceNotes = /^NO CLEAR PATTERN/i.test(analysisText) ? null : analysisText

    const patchRes = await sb(`staff?id=eq.${staffId}&${wsFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        voice_notes: voiceNotes,
        voice_notes_refreshed_at: new Date(nowMs).toISOString(),
        voice_notes_edits_analyzed: editPairs.length,
      }),
    })
    if (!patchRes.ok) return { ok: false, reason: 'persist_failed' }

    return { ok: true, edits_analyzed: editPairs.length, voice_notes: voiceNotes }
  } catch (e) {
    console.error('[voiceNotesRefresh] threw:', e?.message)
    return { ok: false, reason: 'threw' }
  }
}

export { MIN_PAIRS, MAX_PAIRS }
