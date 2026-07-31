// The "why doesn't this clip work" signal captured on Deny — the sibling of
// momentRetire.js, same shape (fixed vocabulary rendered as chips + optional
// free text, plain text[] column, no migration needed to grow the set). See
// migration 202_video_segments_discard_reasons.
//
// Reason keys are validated server-side against this same set
// (api/_routes/editorial/segments/[id].js).
//
// Deliberately NOT the moment vocabulary, though it mirrors its shape. A moment
// is a quote and a segment is a clip, and they fail differently: a clip can be a
// perfectly good quote and still be unusable because the audio is bad or the
// speaker walked out of frame. "Doesn't land as a quote" and "Mis-transcribed"
// have no meaning for a silent b-roll clip. Keeping the two lists separate lets
// each say something true, and lets them diverge as we learn what each is
// actually telling us (Q, 2026-07-30).

export const CLIP_DISCARD_REASONS = [
  { key: 'doesnt_land',  label: "Doesn't land" },
  { key: 'not_social',   label: "Wouldn't work on social" },
  { key: 'off_topic',    label: 'Not relevant to the practice' },
  { key: 'redundant',    label: 'Already have one like this' },
  { key: 'quality',      label: 'Audio or video problem' },
]

export const CLIP_DISCARD_REASON_KEYS = new Set(CLIP_DISCARD_REASONS.map((r) => r.key))
export const CLIP_DISCARD_REASON_LABEL = Object.fromEntries(
  CLIP_DISCARD_REASONS.map((r) => [r.key, r.label]),
)

export const CLIP_DISCARD_NOTE_MAX = 500
