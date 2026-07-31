// The "why doesn't this quote work" signal captured on Retire — the sibling
// of modelRating.js's "what made this land" signal, same shape (fixed reason
// vocabulary rendered as chips + optional free text, plain text[] column, no
// migration needed to grow the set). See migration 199_moments_retire_reasons.
//
// Reason keys are validated server-side against this same set (db/moments.js).
// A retire IS a stronger signal than an approve — approving mostly means "no
// reason to say no yet", while a retire says the quote genuinely doesn't work.
// These reasons exist to make that signal specific enough to eventually act
// on (Q, 2026-07-30), not just to log that someone clicked Retire.

export const MOMENT_RETIRE_REASONS = [
  { key: 'doesnt_land', label: "Doesn't land as a quote" },
  { key: 'not_social', label: "Wouldn't work on social" },
  { key: 'off_topic', label: 'Not relevant to the practice' },
  { key: 'redundant', label: 'Already have one like this' },
  { key: 'transcription_error', label: 'Mis-transcribed / recording error' },
]

export const MOMENT_RETIRE_REASON_KEYS = new Set(MOMENT_RETIRE_REASONS.map((r) => r.key))
export const MOMENT_RETIRE_REASON_LABEL = Object.fromEntries(
  MOMENT_RETIRE_REASONS.map((r) => [r.key, r.label]),
)

export const MOMENT_RETIRE_NOTE_MAX = 500
