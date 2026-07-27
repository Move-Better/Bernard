// Caption/overlay de-duplication.
//
// A persisted video_edit_draft can hold a manual text overlay whose words are
// identical to a spoken caption line. With captions ON, that line then renders
// TWICE on the same frame — once in the karaoke track, once as the offset,
// un-highlighted overlay — which reads to the user as "reels auto-gen with
// multiple caption types" (feedback 478f16c3, 2026-07). The two preview/bake
// surfaces are independent (karaoke ASS vs. overlay SVG) and nothing cross-checks
// them, so the duplicate burns into the exported MP4.
//
// These helpers drop such an overlay from the ffmpeg bake while leaving a
// genuinely-distinct overlay (e.g. an editorial hook card that is NOT a spoken
// line) untouched. The editor-preview mirror lives in src/pages/VideoEditor.jsx
// (normCaptionText + the captionLineTexts memo) — the src/ ↔ api/ import boundary
// forbids sharing this file, so keep the normalizer identical on both sides (see
// the "mirror pair" note in ARCHITECTURE.md). This module is the tested source of
// truth for the bake.
import { groupWordsIntoLines } from './karaokeCaptions.js'

// Trim, lowercase, collapse internal whitespace. Two texts that differ only in
// spacing or case are the "same line" for duplicate purposes.
export function normCaptionText(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Normalized text of each caption LINE the karaoke track will draw, grouped with
// the SAME greedy chunker buildKaraokeAss uses — so the comparison is against the
// exact lines that render, not the raw word stream.
export function captionLineTextSet(words) {
  const set = new Set()
  if (!Array.isArray(words)) return set
  for (const line of groupWordsIntoLines(words)) {
    const t = normCaptionText(line.map((w) => w?.word ?? '').join(' '))
    if (t) set.add(t)
  }
  return set
}

// Drop overlays whose text duplicates a caption line. `captionLineTexts` is a Set
// of already-normalized caption-line strings (from captionLineTextSet). When it's
// empty or absent — captions off, or no word track — nothing is filtered, because
// the overlay is then the ONLY place that text appears and must be kept.
export function dropCaptionDupeOverlays(overlays, captionLineTexts) {
  const list = Array.isArray(overlays) ? overlays : []
  if (!captionLineTexts || !captionLineTexts.size) return list
  return list.filter((o) => !captionLineTexts.has(normCaptionText(o?.text)))
}
