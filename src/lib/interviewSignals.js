// Pure signal-parsing over model output for the interview surfaces.
//
// Extracted verbatim from InterviewSession.jsx (which exported nothing but its
// default component, so none of this was reachable from a test). The stop-phrase
// and transient-error helpers additionally existed as byte-equivalent copies in
// OnboardingInterview.jsx and BrandInterview.jsx; those now import from here so
// the three surfaces cannot drift apart.
//
// Everything in this module is pure: string/object in, value out. No React, no
// network, no DOM.

// Concrete noun list for shallow-answer detection (Feature 2)
export const CONCRETE_NOUNS = ['patient', 'person', 'name', 'case', 'example', 'time', 'moment', 'client', 'athlete', 'runner', 'worker']

export function isShallowAnswer(text) {
  const words = text.trim().split(/\s+/)
  if (words.length >= 15) return false
  const lower = text.toLowerCase()
  return !CONCRETE_NOUNS.some((noun) => lower.includes(noun))
}

// Token format: [CONTRAST][StafflastName] or legacy [CONTRAST]
// Extract the embedded clinician name if present, e.g. [CONTRAST][Sarah] → "Sarah"
export function extractContrastName(text) {
  const m = text.match(/\[CONTRAST\]\[([^\]]+)\]/)
  return m ? m[1] : null
}

export function stripContrastToken(text) {
  return text.replace(/\[CONTRAST\](\[[^\]]*\])?/g, '').trim()
}

export function hasContrastSignal(text) {
  return text.includes('[CONTRAST]')
}

// Token format: [AGREEMENT][StaffName] or legacy [AGREEMENT]
// Extract the embedded clinician name if present, e.g. [AGREEMENT][Sarah] → "Sarah"
export function extractAgreementName(text) {
  const m = text.match(/\[AGREEMENT\]\[([^\]]+)\]/)
  return m ? m[1] : null
}

export function stripAgreementToken(text) { return text.replace(/\[AGREEMENT\](\[[^\]]*\])?/g, '').trim() }
export function hasAgreementSignal(text)   { return text.includes('[AGREEMENT]') }

export function stripGapToken(text) { return text.replace(/\[GAP\]/g, '').trim() }
export function hasGapSignal(text)  { return text.includes('[GAP]') }

export const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Session-end phrases — matched at end of utterance to signal interview completion.
// "next question" and "move on" are intentionally excluded here: they're opt-out
// signals handled by emotionDetection (→ 'resistant' state) so the AI transitions
// topics gracefully rather than ending the session.
export const STOP_PHRASES = [
  "that's all",
  "that's it",
  "i'm done",
  "i am done",
  "send it",
  "send that",
  "submit",
  "done",
]

export function detectAndStripStopPhrase(transcript) {
  const normalized = transcript.trimEnd().toLowerCase()
  for (const phrase of STOP_PHRASES) {
    if (normalized.endsWith(phrase)) {
      const stripped = transcript.trimEnd()
      const cleaned = stripped.slice(0, stripped.length - phrase.length).trimEnd()
      return cleaned.length > 0 ? cleaned : ''
    }
  }
  return null
}

// Is a stream failure worth auto-retrying? Auth (401/403) and rate-limit (429)
// won't recover on retry; everything else (gateway→Anthropic upstream blips
// surfaced as "A network error occurred", 5xx, timeouts, generic fetch aborts)
// is transient and safe to re-run the turn for.
export function isTransientStreamError(e) {
  const status = e?.status
  if (status === 401 || status === 403 || status === 429) return false
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  // 529 = AI gateway overloaded (transient); other 5xx may include structural errors
  // (invalid model, quota hard-stop) but we can't distinguish without parsing the body.
  // Retry once is acceptable for structural errors — the 3-retry max is the real cap.
  return true
}

// Derive rough "clinician's voice %" from the raw provenanceJson blocks string.
// verbatim + close_paraphrase blocks = paragraphs that came from the clinician's
// own words. Returns 0–100 or null when data is absent / unparseable.
export function deriveVoicePct(provenanceJson) {
  if (!provenanceJson) return null
  try {
    const parsed = JSON.parse(provenanceJson)
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : []
    if (blocks.length === 0) return null
    const voiceBlocks = blocks.filter(
      (b) => b.source_type === 'verbatim' || b.source_type === 'close_paraphrase',
    ).length
    return Math.round((voiceBlocks / blocks.length) * 100)
  } catch {
    return null
  }
}
