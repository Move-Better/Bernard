// Story field derivation — the single client-side source of truth for turning a
// content_items row (platform = 'instagram_story') into the three things a
// Story needs: the overlay text, the link-sticker label, and the background.
//
// Story rows are persisted inconsistently across generators (briefs/generate,
// broadcast, hand edits), so every reader must be defensive:
//   - content       — usually the overlay headline, but older/raw rows hold the
//                      full model output INCLUDING a "LINK_STICKER_TEXT: …" line
//                      (this is the raw dump the PlainPreview fallback showed).
//   - overlay_text   — a string for stories; a legacy {hook,subhead,cta} object
//                      for pre-065 carousels (vestigial — handle both shapes).
//   - text_card      — branded-card JSONB { headline, cta, … } when no media;
//                      text_card.cta carries the link-sticker label.
//
// deriveStory() collapses all of that into { overlay, sticker } so the preview
// and the editor never show a raw "LINK_STICKER_TEXT:" line again.

const STICKER_RE = /^LINK_STICKER_TEXT:\s*(.+)$/im

// Split a raw model output into { overlay, sticker }. The overlay is everything
// before the LINK_STICKER_TEXT line (blank lines trimmed); the sticker is the
// label after it. When there's no sticker line, the whole string is the overlay.
export function parseStoryContent(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const m = text.match(STICKER_RE)
  if (!m) return { overlay: text.trim(), sticker: '' }
  const overlay = text.slice(0, m.index).trim()
  return { overlay, sticker: (m[1] || '').trim() }
}

// Coerce overlay_text (string | {hook|headline|…} | null) to a plain string.
function overlayString(overlayText) {
  if (!overlayText) return ''
  if (typeof overlayText === 'string') return overlayText.trim()
  if (typeof overlayText === 'object') {
    return String(overlayText.hook || overlayText.headline || overlayText.text || '').trim()
  }
  return ''
}

// The canonical reader. Precedence, most-authoritative first:
//   overlay  : text_card.headline → overlay_text → parsed-from-content
//   sticker  : text_card.cta      → parsed-from-content
// Always strips a stray LINK_STICKER_TEXT line out of the overlay so it can
// never render raw.
export function deriveStory(piece) {
  const p = piece || {}
  const fromContent = parseStoryContent(p.content)
  const tc = p.text_card && typeof p.text_card === 'object' ? p.text_card : null

  let overlay = (tc && typeof tc.headline === 'string' && tc.headline.trim())
    || overlayString(p.overlay_text)
    || fromContent.overlay
  // Defensive: if overlay still carries a sticker line (e.g. overlay_text held
  // the raw dump), strip it.
  overlay = parseStoryContent(overlay).overlay

  const sticker = (tc && typeof tc.cta === 'string' && tc.cta.trim())
    || fromContent.sticker
    || ''

  return { overlay: overlay || '', sticker: sticker || '' }
}
