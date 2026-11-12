// Shared voice-fidelity presentation helpers — ONE source for the tier
// thresholds, flag labels, and severity dots. Consumed by both the full
// VoiceFidelityBadge (story-detail publish panel) and the compact VoiceChip
// (editor header). Kept free of react/lucide imports so it stays a pure lib;
// the consuming component maps `iconName` → a lucide component itself.
//
// The score is content_items.voice_fidelity_score (0-100) from the pass-2
// voice audit (api/_routes/content-items/voice-audit.js). >=90 reads as the
// clinician; <50 has been translated out of their voice.

// Plain-language definition of the score, surfaced as a hover tooltip on both
// the full badge and the compact chip so the number is never unexplained.
export const VOICE_FIDELITY_TOOLTIP =
  'How closely this draft reads like you actually talk. Bernard scores it 0–100 by comparing the draft against your real words — 90+ sounds like you, under 50 has drifted out of your voice.'

export const FLAG_LABELS = {
  vocabulary_swap:   'Vocabulary swap',
  imposed_structure: 'Imposed structure',
  smoothed_opinion:  'Smoothed opinion',
  fabricated_claim:  'Fabricated claim',
}

export const SEVERITY_DOT = {
  high:   'bg-destructive',
  medium: 'bg-warning',
  low:    'bg-muted-foreground',
}

// Tier → semantic token set (see CLAUDE.md brand-color checklist — uses the
// shared --success/--info/--warning/--destructive tokens, never raw colors).
export function scoreTier(score) {
  const s = typeof score === 'number' ? score : 0
  if (s >= 90) return { label: 'Faithful',                 tone: 'success',     iconName: 'shield', text: 'text-success',     bg: 'bg-success/10',     border: 'border-success/30' }
  if (s >= 70) return { label: 'Mostly faithful',          tone: 'info',        iconName: 'shield', text: 'text-info',        bg: 'bg-info/10',        border: 'border-info/30' }
  if (s >= 50) return { label: 'Worth a look',             tone: 'warning',     iconName: 'alert',  text: 'text-warning',     bg: 'bg-warning/10',     border: 'border-warning/30' }
  return       { label: "Doesn't sound like you",          tone: 'destructive', iconName: 'alert',  text: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30' }
}

// ── Where the words came from (post editor audit B, 2026-11-11) ─────────────
// provenance.summary counts how much of a draft came from the interview. It is
// a DIFFERENT measure from the voice score above (Bernard's read of whether it
// sounds like the person), so it lives inside the voice chip's details, named
// for what it counts, instead of as a second "% in clinician's voice" number.
// Only blogs carry provenance today; everything else returns null.
export const CLOSE_READ_PCT = 40

export function wordSources(piece) {
  const s = piece?.provenance?.summary
  if (!s) return null
  const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0)
  const blocks = piece?.provenance?.blocks
  return {
    asSaid: n(s.verbatim_pct),
    reworded: n(s.paraphrase_pct),
    bernard: n(s.synthesis_pct),
    prior: n(s.prior_corpus_pct),
    echoes: n(s.voice_phrase_echo_count),
    phrases: Array.isArray(blocks) ? blocks.filter((b) => b?.source_type === 'verbatim').length : 0,
  }
}

// Bernard wrote more than CLOSE_READ_PCT of the words: the chip says so in the
// top bar, score or not (that warning used to live only in the publish panel).
export function needsCloseRead(piece) {
  const w = wordSources(piece)
  return !!w && w.bernard > CLOSE_READ_PCT
}
