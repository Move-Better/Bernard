// Who is actually TALKING in this moment — clinician or patient?
//
// The problem this solves: nothing in the schema could answer that question.
// `media_assets.speaker_role` looks like it should, but it is the *asset's*
// nominal role, assigned per file, and it is wrong often enough to be unusable
// as a gate. The clearest real example on movebetter is `Melanie Final Cut.mp4`
// — a patient testimonial about Lyme disease and a wheelchair — stored as
// speaker_role='clinician', asset_purpose='interview'. Six of the workspace's
// top-eleven scored moments are patient-voice, and every one of them sits on an
// asset labelled 'clinician'.
//
// The label has to be per-MOMENT, not per-asset, because one interview file
// genuinely contains both people: the clinician asks, the patient answers, and
// the moment miner cuts standalone windows from either. An asset-level column
// cannot represent that no matter how carefully it is filled in.
//
// So: classify each segment from its own transcript. The question is strictly
// "whose mouth are these words coming out of", NOT "who is being talked about"
// — a clinician describing a category of patients is still clinician voice, and
// that distinction is the one the model has to get right.
//
// Model choice is empirical, not assumed: see tests/lib/speakerVoice.test.js and
// the validation table in the PR. Haiku is used because it measured more precise
// than Sonnet on real labelled segments — the same result the caption-fidelity
// judge found. A verification task is not a generation task; bigger is not
// automatically better, so re-probe if you change the model.

import { z } from 'zod'

// The vocabulary. Deliberately includes 'mixed' and 'unknown' rather than
// forcing a binary — a moment that is genuinely a two-way exchange, or one with
// too little transcript to tell, must be representable. Callers that need a
// clean signal should treat anything other than 'clinician' as "not safe to
// assume clinician", rather than collapsing the middle into a guess.
export const SPEAKER_VOICES = Object.freeze({
  CLINICIAN: 'clinician',
  PATIENT: 'patient',
  MIXED: 'mixed',
  UNKNOWN: 'unknown',
})

const VALID = new Set(Object.values(SPEAKER_VOICES))

const voiceSchema = z.object({
  voice: z
    .enum(['clinician', 'patient', 'mixed', 'unknown'])
    .describe('Whose voice speaks the majority of these words.'),
  confidence: z.number().min(0).max(1).describe('0-1 confidence in the voice call.'),
  why: z.string().describe('One short phrase citing the specific cue that decided it.'),
})

// Below this much transcript there is nothing to judge — do not spend a model
// call, and do not let the model guess. 'unknown' is the honest answer.
const MIN_CHARS = 40

export const SPEAKER_VOICE_INSTRUCTIONS = `You label WHO IS SPEAKING in a short transcript from a healthcare clinic's video.

Answer exactly one question: whose mouth are these words coming out of?

clinician — a practitioner speaking. Teaching, explaining mechanism, describing
  what they see across patients, telling the audience what to do, asking an
  interview question. Talking ABOUT patients is still clinician voice: "I see a
  lot of women who have back pain since having kids" is clinician.
patient  — a patient/client speaking about their OWN experience. Tells: "when I
  started seeing Dr X", "my pain", "I couldn't, now I can", naming the
  practitioner in the third person, describing their own treatment or recovery.
mixed    — a genuine two-way exchange where both speak a meaningful share.
unknown  — too little text, or no usable cue either way.

The single most common error is calling a patient's own recovery story
"clinician" because it happens to be recorded in a clinic and mentions clinical
terms. If the speaker is narrating THEIR OWN body, symptoms, or treatment as the
person who received it, that is patient — regardless of the subject matter.

Return only the JSON object. Keep "why" under 12 words and quote the deciding cue.`

/**
 * Classify one segment's speaker voice.
 *
 * Never throws — an unavailable model or a malformed response yields
 * 'unknown' at zero confidence, so a classification outage degrades to "we
 * don't know" rather than to a confident wrong label.
 *
 * @param {Object} p
 * @param {string} p.transcript  — the segment's own transcript_excerpt
 * @param {string} [p.hook]      — the segment's hook line, extra context
 * @param {string} [p.model]     — override for probing
 * @returns {Promise<{voice: string, confidence: number, why: string}>}
 */
export async function classifySpeakerVoice({ transcript, hook = '', model = 'anthropic/claude-haiku-4-5' }) {
  const text = String(transcript || '').trim()
  if (text.length < MIN_CHARS) {
    return { voice: SPEAKER_VOICES.UNKNOWN, confidence: 0, why: 'transcript too short' }
  }

  const user = [
    hook ? `Hook: ${hook}` : null,
    `Transcript:\n${text.slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const { generateObject } = await import('ai')
    const { object } = await generateObject({
      model,
      schema: voiceSchema,
      // AI SDK v7: the field is `instructions`. `system` is a deprecated alias
      // and passing the wrong key silently ships NO system prompt at all.
      instructions: SPEAKER_VOICE_INSTRUCTIONS,
      messages: [{ role: 'user', content: user }],
      maxOutputTokens: 200,
    })
    const voice = VALID.has(object?.voice) ? object.voice : SPEAKER_VOICES.UNKNOWN
    const confidence = Number.isFinite(object?.confidence)
      ? Math.min(1, Math.max(0, object.confidence))
      : 0
    return { voice, confidence, why: String(object?.why || '').slice(0, 120) }
  } catch (e) {
    console.error('[speakerVoice] classify failed:', e?.message)
    return { voice: SPEAKER_VOICES.UNKNOWN, confidence: 0, why: 'classifier unavailable' }
  }
}

/**
 * Classify a batch of segments with bounded concurrency.
 * Order-aligned with the input, like scoreSegments — index i in equals index i
 * out — so callers can zip it straight onto their insert rows. Never throws.
 *
 * @param {Array<{transcript_excerpt?: string, hook?: string}>} segments
 * @returns {Promise<Array<{voice: string, confidence: number, why: string}>>}
 */
export async function classifySegmentVoices(segments, { concurrency = 4, model } = {}) {
  const list = Array.isArray(segments) ? segments : []
  const out = new Array(list.length)
  let next = 0
  async function worker() {
    while (next < list.length) {
      const i = next++
      const s = list[i] || {}
      out[i] = await classifySpeakerVoice({
        transcript: s.transcript_excerpt || '',
        hook: s.hook || '',
        ...(model ? { model } : {}),
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
  return out
}

/**
 * True when a segment is safe to treat as the clinician talking.
 * Anything unclassified, patient, mixed, or low-confidence is NOT — the caller
 * asked for clinician voice, and "probably" is not an answer for a gate.
 */
export function isClinicianVoice(seg, minConfidence = 0.6) {
  return seg?.speaker_voice === SPEAKER_VOICES.CLINICIAN &&
    (seg?.speaker_voice_confidence ?? 0) >= minConfidence
}
