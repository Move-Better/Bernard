// Shared constants and tiny helpers for the video editor.
// Extracted verbatim from VideoEditor.jsx during the component split.

// ── helpers ──────────────────────────────────────────────────────────────────
// Output shape (Reel / Feed / Wide), the channel each bakes through, and the
// per-platform default — all in src/lib/videoFormats.js so the preview==bake
// invariant is testable without this file's module graph.
export const fmt = (s) => {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60); const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// An overlay selection is the object { type:'overlay', id }; everything else
// (inspector-key strings, or null when nothing is selected) is not. Guarding on
// `sel != null` matters because typeof null === 'object' — a bare
// `typeof sel === 'object'` would treat the deselected state as an overlay and
// crash reading sel.id.
export const isOverlaySel = (s) => s != null && typeof s === 'object'
// Clip window is capped to the server's MAX_RENDER_SECONDS (brandRenderVideo.js).
// The timeline trim handles clamp to this so a clip can't silently truncate at render.
export const MAX_CLIP_SECONDS = 60
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const HEX6_RE = /^#[0-9a-fA-F]{6}$/
// hook_card and title are the two roles a TEMPLATE can express (see
// videoTemplateCapture.js); lower_third and callout are per-clip annotations.
export const OVERLAY_ROLES = [['hook_card', 'Hook card'], ['title', 'Title'], ['lower_third', 'Caption bar'], ['callout', 'Callout']]
export const ROLE_FS = { title: 0.044, lower_third: 0.030, callout: 0.034, hook_card: 0.040 }
