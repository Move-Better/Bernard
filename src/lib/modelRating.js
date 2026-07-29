// The "this composition came together well" signal — a pre-publish human
// craft judgment, distinct from `performed_well` (post-publish, audience
// responded). See ARCHITECTURE.md / project-media-library-suggestions memory
// for why the two stay separate: this one feeds generation as a "write more
// like this" example immediately, without waiting on engagement data that
// (per GBP/Buffer) often never arrives.
//
// Reason keys are a fixed, shared vocabulary — the client renders them as
// chips, the server validates a patch against this same set (db/content.js),
// and draftAtom's exemplar context turns them into plain-language hints for
// the model. Growing the set is additive (new key, new label) and needs no
// migration since model_reasons is a plain text[].

export const MODEL_REASONS = [
  { key: 'sounds_genuine',    label: 'Sounds genuine' },
  { key: 'media_choice_good', label: 'Media choice is good' },
  { key: 'hook_grabs',        label: 'The hook grabs' },
  { key: 'tight_structure',   label: 'Tight structure' },
  { key: 'right_length',      label: 'Right length' },
  { key: 'cta_lands',         label: 'The CTA lands' },
]

export const MODEL_REASON_KEYS = new Set(MODEL_REASONS.map((r) => r.key))
export const MODEL_REASON_LABEL = Object.fromEntries(MODEL_REASONS.map((r) => [r.key, r.label]))

export const MODEL_NOTE_MAX = 500
