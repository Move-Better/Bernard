// Shared voice-fidelity presentation helpers — ONE source for the tier
// thresholds, flag labels, and severity dots. Consumed by both the full
// VoiceFidelityBadge (story-detail publish panel) and the compact VoiceChip
// (editor header). Kept free of react/lucide imports so it stays a pure lib;
// the consuming component maps `iconName` → a lucide component itself.
//
// The score is content_items.voice_fidelity_score (0-100) from the pass-2
// voice audit (api/_routes/content-items/voice-audit.js). >=90 reads as the
// clinician; <50 has been translated out of their voice.

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
