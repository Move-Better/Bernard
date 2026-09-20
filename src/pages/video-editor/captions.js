// Caption preview styling + word layout for the video editor.
//
// Extracted verbatim from VideoEditor.jsx so it can be tested. Every function
// here is one half of a documented CLIENT/SERVER MIRROR PAIR:
//
//   captionCss       <-> CAPTION_STYLES      in api/_lib/karaokeCaptions.js
//   CAPTION_BASE_FS_PCT / CAPTION_SIZE_SCALE
//                    <-> CAPTION_BASE_FS / OVERLAY_SIZE_SCALE
//                                            in api/_lib/brandRenderVideo.js
//   sliceWords       <-> sliceWordsToWindow  in api/_lib/karaokeCaptions.js
//   groupLines       <-> groupWordsIntoLines in api/_lib/karaokeCaptions.js
//   normCaptionText  <-> normCaptionText     in api/_lib/captionOverlayDedup.js
//
// A preview that styles or times a clip differently from the bake is exactly
// the drift these mirrors exist to prevent. Pure: no React, no DOM.

import { WORKSPACE_DEFAULT_ACCENT } from '@/lib/brandSwatches'

// Caption preview sizing — client mirror of CAPTION_BASE_FS (0.068) and
// OVERLAY_SIZE_SCALE in api/_lib/brandRenderVideo.js, expressed in cqw (percent
// of the video frame's width) so the preview and the bake agree.
// KEEP IN SYNC — a Size control that previews one size and exports another is
// worse than no control, because it teaches the user the wrong thing.
export const CAPTION_BASE_FS_PCT = 6.8
export const CAPTION_SIZE_SCALE = { small: 0.75, medium: 1.0, large: 1.35 }
export const CAPTION_STYLE_OPTS = [
  { id: 'bold', label: 'Bold' },
  { id: 'word_box', label: 'Word box' },
  { id: 'accent_fill', label: 'Accent fill' },
  { id: 'glow', label: 'Glow' },
  { id: 'underline', label: 'Underline' },
  { id: 'pop', label: 'Pop' },
]
// Per-glyph black OUTLINE ring, em-scaled so it tracks the Size control — the
// preview mirror of the ASS bake's outline (karaokeCaptions.js: every style draws
// an outline of width max(2, fontSize×0.08) × outlineMul). Without it the plain
// outline styles (bold / underline / pop) read as a SOFT drop-shadow in the
// editor and a HARD-outlined caption once baked — Philip's "the karaoke style
// does not match what was done in editing" report. Box/halo styles (word_box,
// accent_fill, glow) already carry their own contrast treatment, matching how
// the bake gives them a box/soft-halo rather than relying on a plain outline.
export function ringShadow(mul = 1) {
  const w = (0.055 * mul).toFixed(3)
  const d = (0.039 * mul).toFixed(3)
  return `${w}em 0 #000,-${w}em 0 #000,0 ${w}em #000,0 -${w}em #000,` +
    `${d}em ${d}em #000,-${d}em ${d}em #000,${d}em -${d}em #000,-${d}em -${d}em #000,` +
    '0 2px 8px rgba(0,0,0,.5)'
}
// Preview styling per caption preset (approximates the ASS bake). Returns the
// spoken-word style, the upcoming-word style, and any container wrap. KEEP IN
// SYNC with CAPTION_STYLES in api/_lib/karaokeCaptions.js — the preview and the
// bake styling the same clip differently is exactly the drift this mirrors out.
export function captionCss(style, accent) {
  // Fallback must equal the bake-side default accent (brandRender.js
  // DEFAULT_ACCENT). caption.accent is seeded from the tenant workspace on
  // hydrate, so this only paints the pre-hydrate frame / a pathological draft —
  // never a Bernard PRODUCT color (that would put app chrome into tenant content).
  const a = accent || WORKSPACE_DEFAULT_ACCENT
  switch (style) {
    case 'word_box':    return { active: { color: '#fff', background: 'rgba(0,0,0,.72)', padding: '0 5px', borderRadius: 4 }, base: { color: '#fff', background: 'rgba(0,0,0,.72)', padding: '0 5px', borderRadius: 4 }, wrap: {} }
    // base is DARK, not white: the spoken word is white here, so a white base
    // erases the highlight entirely. Words light up as they're said.
    case 'accent_fill': return { active: { color: '#fff' }, base: { color: '#1A1A1A' }, wrap: { background: a, padding: '3px 10px', borderRadius: 8 } }
    // The halo is dark, matching the bake. An accent halo around an accent-
    // filled spoken word is the same hue on itself — no contrast at any alpha.
    case 'glow':        return { active: { color: a, textShadow: '0 0 14px rgba(0,0,0,.8), 0 2px 6px rgba(0,0,0,.65)' }, base: { color: '#fff', textShadow: '0 0 14px rgba(0,0,0,.8), 0 2px 6px rgba(0,0,0,.65)' }, wrap: {} }
    case 'underline':   return { active: { color: '#fff', borderBottom: `3px solid ${a}`, textShadow: ringShadow(1) }, base: { color: '#fff', textShadow: ringShadow(1) }, wrap: {} }
    case 'pop':         return { active: { color: a, display: 'inline-block', transform: 'scale(1.14)', textShadow: ringShadow(1) }, base: { color: '#fff', textShadow: ringShadow(1) }, wrap: {} }
    default:            return { active: { color: a, textShadow: ringShadow(1) }, base: { color: '#fff', textShadow: ringShadow(1) }, wrap: {} } // bold
  }
}

// Slice whole-source words to a clip window, rebased to 0 (mirrors the server's
// sliceWordsToWindow — the editor preview must match the bake).
export function sliceWords(words, startSec, durationSec) {
  if (!Array.isArray(words)) return []
  const s = Math.max(0, startSec || 0); const end = s + Math.max(0, durationSec || 0)
  const out = []
  for (const w of words) {
    if (!w) continue
    const ws = Number(w.start); const we = Number(w.end)
    if (!Number.isFinite(ws) || !Number.isFinite(we)) continue
    // Zero-duration words are real (Whisper's 20ms frame hop) and are a POINT,
    // not a span — kept when s <= t < end. Mirrors the server's sliceWordsToWindow.
    const isPoint = we === ws
    if (isPoint ? (ws < s || ws >= end) : (we <= s || ws >= end)) continue
    const word = String(w.word || '').trim(); if (!word) continue
    const start = Math.max(0, ws - s); const wEnd = Math.min(end - s, we - s)
    if (wEnd >= start) out.push({ word, start, end: wEnd })
  }
  return out
}
// Greedy phrase grouping (≤5 words / ≤26 chars), mirrors groupWordsIntoLines.
export function groupLines(words) {
  const lines = []; let cur = []; let chars = 0
  for (const w of words) {
    const wl = (w.word.length || 0) + 1
    if (cur.length && (cur.length >= 5 || chars + wl > 26)) { lines.push(cur); cur = []; chars = 0 }
    cur.push(w); chars += wl
  }
  if (cur.length) lines.push(cur)
  return lines.map((ws) => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws, text: ws.map((w) => w.word).join(' ') }))
}

// Trim, lowercase, collapse whitespace — mirror of normCaptionText in
// api/_lib/captionOverlayDedup.js (the src/ ↔ api/ boundary forbids sharing it,
// so keep the two identical). Used to skip a manual overlay that merely
// duplicates a spoken caption line, so the preview matches the deduped bake.
export function normCaptionText(s) {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}
