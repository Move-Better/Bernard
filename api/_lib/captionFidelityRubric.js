// api/_lib/captionFidelityRubric.js
//
// SINGLE SOURCE OF TRUTH for the caption-fidelity rubric. Imported by:
//   - api/_lib/captionFidelity.js          (live scorer, waitUntil after render)
//   - scripts/voice-fidelity-captions.mjs   (offline fixture refresh + dashboard)
//   - scripts/u1-caption-ab-smoke.mjs        (A/C experiments)
// so the prompt + dimensions can never drift between them again.
//
// PURE: no env reads, no network, no side effects. Safe to import anywhere
// (including the function-bundle smoke test).
//
// ─────────────────────────────────────────────────────────────────────────────
// Why this rubric was rewritten (2026-05-31):
//
// The previous rubric graded a caption WITHOUT ever seeing the clip transcript,
// and two of its five dimensions (`clinical_texture`, `specificity`) explicitly
// rewarded clinical/technical language ("real anatomy, technique names"). So it
// wasn't measuring faithfulness to what the clinician said — it was rewarding
// "sounds clinical + echoes the catalogued phrases." That breaks the moment a
// clinician shares an emotional challenge or a personal story: a caption that
// faithfully reflects that gets DINGED for having no anatomy in it.
//
// The fix splits the two things the old rubric conflated and feeds the
// transcript in as the gold reference:
//   • said_fidelity — does the caption faithfully convey WHAT WAS ACTUALLY SAID?
//   • voice_match   — does it sound like THIS PERSON, in whatever register they
//                     are using (clinical OR emotional) — never rewarding jargon.
//   • naturalness   — real human, not a content-mill/corporate template (register-neutral).
//   • tightness     — title + caption don't restate each other; caption is crisp.
// `clinical_texture`, `specificity`, and `brand_fit` are gone (folded in or dropped).
// ─────────────────────────────────────────────────────────────────────────────

export const FIDELITY_DIMENSIONS = ['said_fidelity', 'voice_match', 'naturalness', 'tightness']

/**
 * Build the evaluator prompt. Pure — returns { instructions, user }.
 * NOTE: the system half is `instructions` (AI SDK v7 field), NOT `system`.
 * Callers MUST read `.instructions` — reading `.system` passes undefined, so
 * the judge runs with no register-neutrality preamble AND rambles past the
 * token cap into unparseable JSON (parseFidelity → null). See PR history.
 *
 * @param {object} p
 * @param {string} p.topic          — thumbnail/title text
 * @param {string} p.caption        — caption under test
 * @param {string} [p.transcript]   — what the clinician ACTUALLY said in this clip
 *                                     (segment excerpt or asset transcription). Empty
 *                                     when there's no audio/transcript on record.
 * @param {Array}  [p.phrases]      — [{ phrase }] voice reference (one signal, not the gold)
 * @param {string} p.staffName
 * @param {string} p.workspaceName
 */
export function buildFidelityPrompt({ topic, caption, transcript = '', phrases = [], staffName, workspaceName }) {
  // Give the judge enough of the reference to actually verify faithfulness. The old
  // 2500-char cap silently defeated draftAtom's 24k TRANSCRIPT_MAX (the interview was
  // re-cut to 2500 here), so anything a faithful caption drew from later in the
  // interview looked "invented" — a false-positive machine once we gate on it. Clip
  // transcripts (the story-package path) are short, so this only widens the interview
  // path; 24k matches draftAtom's TRANSCRIPT_MAX so the judge sees the whole reference.
  const said = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 24000)
  const hasSaid = said.length > 0
  const phraseExamples = (phrases || []).slice(0, 8).map((x) => `- "${x.phrase}"`).join('\n')
  const hasPhrases = phraseExamples.length > 0

  return {
    instructions:
`You are a precise evaluator of SHORT social-distribution copy (a thumbnail title +
caption) for a real person's clinical practice. You judge two things above all:
(1) FAITHFULNESS — does the caption reflect what the person ACTUALLY said in this
clip, without inventing or distorting it? and (2) VOICE — does it sound like THIS
person speaking?

CRITICAL — you are NOT a "sounds clinical" detector. Do NOT reward anatomy,
technique names, diagnostic jargon, or clinical register for their own sake, and
do NOT penalize a caption for being warm, personal, or emotional. People share
personal struggles and stories as well as clinical insight; a caption that
faithfully carries an emotional or personal moment in the person's own voice is
EXCELLENT and should score high. Register (clinical vs. personal) is the speaker's
choice, never a quality signal.

The single most serious failure is FABRICATION: the caption presenting a SPECIFIC
instance or detail as real that the transcript does NOT contain — an invented
individual patient and their story, a specific age, a specific number or statistic,
a specific date or duration ("week four", "six years"), a specific named outcome, or
a made-up quote. The test is CATEGORY vs SPECIFIC: naming a GROUP the speaker
actually discussed (e.g. "runners", "powerlifters", "surfers") is faithful — but
turning it into ONE specific person with a backstory, an age, and a recovery timeline
the speaker never gave IS fabrication. A general statement, a paraphrase, and anatomy
or a mechanism the speaker described are all faithful and must NOT be flagged. List
each invented specific in invented_claims. Return ONLY valid JSON — no markdown, no preamble.`,
    user:
`Evaluate this title + caption, written for ${staffName} at ${workspaceName}. It will
be posted as the social caption and burned into the video's subtitles.

${hasSaid
  ? `WHAT THE CLINICIAN ACTUALLY SAID IN THIS CLIP (the gold reference for faithfulness —
the caption should reflect THIS, paraphrased, not invent beyond it):
"""
${said}
"""`
  : `(No transcript on record for this clip — score said_fidelity at 5; you cannot check
faithfulness without a reference. Judge the other dimensions normally.)`}

${hasPhrases
  ? `HOW THIS PERSON TENDS TO SPEAK (a sample of their voice — match the rhythm/cadence/
framing, NOT a checklist of words to echo; they speak in many registers):
${phraseExamples}`
  : `(No voice sample on record for this person yet — score voice_match at 5.)`}

TITLE (thumbnail text, ${(topic || '').length} chars):
"${topic || ''}"

CAPTION (subtitle + social copy, ${(caption || '').length} chars):
"${caption || ''}"

Score each dimension 1–10 and return EXACTLY this JSON shape (no other keys):
{
  "said_fidelity": <1-10; how faithfully the caption conveys what was ACTUALLY said above —
    captures the real point, no invented claims, no distortion${hasSaid ? '' : '; score 5 (no transcript to compare)'}>,
  "voice_match": <1-10; sounds like THIS person's rhythm + word choice in whatever register
    they used (clinical OR personal/emotional). Do NOT reward jargon${hasPhrases ? '' : '; score 5 (no voice sample)'}>,
  "naturalness": <1-10; sounds like a real human talking, not a generic content-mill or
    corporate template. Register-neutral>,
  "tightness": <1-10 INVERSE redundancy — 10=title and caption each add something and the
    caption is crisp; 1=they restate each other or it's padded>,
  "invented_claims": [<0–5 SHORT phrases (≤8 words each). Each names a SPECIFIC instance or detail
    the caption presents as real but the transcript does NOT contain — a made-up individual patient
    and their story, an age, a number/statistic, a date or duration, or a specific outcome. Naming a
    GROUP the speaker discussed is fine; a general statement, a paraphrase, or anatomy/mechanism the
    speaker described is fine — do NOT list those. Empty array [] if nothing is invented${hasSaid ? '' : '; no transcript to verify against — return []'}>],
  "red_flag": "<one short phrase: the single biggest issue, or 'none'. Do NOT cite missing
    clinical/anatomical language as a flag>"
}`,
  }
}

/**
 * Parse the evaluator's raw JSON text into { overall, breakdown }.
 * Tolerant of ```json fences. Returns null if no scorable dimensions parsed.
 *
 * @param {string} rawText
 * @param {object} [extra] — merged into breakdown (e.g. has_phrases, model)
 */
export function parseFidelity(rawText, extra = {}) {
  const raw = String(rawText || '').trim()
  const tryParse = (s) => { try { return JSON.parse(s) } catch { return null } }
  let r = tryParse(raw)
  if (!r) r = tryParse(raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
  // The judge occasionally wraps the object in a sentence of preamble/trailer
  // despite the "ONLY valid JSON" instruction — recover the first {...} object
  // rather than dropping the whole score to null (a null silently disables the gate).
  if (!r) { const m = raw.match(/\{[\s\S]*\}/); if (m) r = tryParse(m[0]) }
  if (!r || typeof r !== 'object') return null
  const valid = FIDELITY_DIMENSIONS.filter((d) => typeof r[d] === 'number' && isFinite(r[d]))
  if (!valid.length) return null
  const clampedScores = valid.map((d) => Math.max(1, Math.min(10, r[d])))
  const overall = Number((clampedScores.reduce((s, v) => s + v, 0) / valid.length).toFixed(2))
  // Fabrication is a SEPARATE gate signal, not part of `overall` — a piece with
  // invented specifics but good voice must not be averaged into a passing score
  // (that's how it slipped through before). Callers gate on `fabrication` directly.
  const inventedClaims = Array.isArray(r.invented_claims)
    ? r.invented_claims
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().slice(0, 200))
        .slice(0, 5)
    : []
  const breakdown = {
    said_fidelity: r.said_fidelity ?? null,
    voice_match:   r.voice_match ?? null,
    naturalness:   r.naturalness ?? null,
    tightness:     r.tightness ?? null,
    invented_claims: inventedClaims,
    fabrication:   inventedClaims.length > 0,
    red_flag:      r.red_flag || null,
    ...extra,
  }
  return { overall, breakdown }
}
