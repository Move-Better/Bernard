// Brand color swatches for the in-app color pickers (template editors, slide
// text styling). Gathers the workspace's palette from the Brand Kit, which is
// stored on the brand_style JSONB column: {primary_colors, secondary_colors,
// accent_color}. (There is no separate brand_kit_style column — the #1458
// Primary/Secondary/Accent buckets live inside brand_style.) Falls back to the
// legacy colors object, so a picker can offer one-click "your brand color" chips
// next to the freeform hex picker. Deduped, validated to 6-digit hex, uppercased.

const HEX6 = /^#?[0-9a-fA-F]{6}$/

function normHex(h) {
  if (!h || typeof h !== 'string') return null
  const v = h.trim()
  if (!HEX6.test(v)) return null
  return (v.startsWith('#') ? v : `#${v}`).toUpperCase()
}

/** Ordered, deduped brand hex list (primary → secondary → accent → legacy). */
export function brandSwatches(workspace) {
  const bs = workspace?.brand_style || {}
  const raw = [
    ...(Array.isArray(bs.primary_colors) ? bs.primary_colors : []),
    ...(Array.isArray(bs.secondary_colors) ? bs.secondary_colors : []),
    bs.accent_color,
    workspace?.colors?.primary,
    workspace?.colors?.secondary,
  ]
  const seen = new Set()
  const out = []
  for (const c of raw) {
    const n = normHex(c)
    if (n && !seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}

// White + black are the two most-used text colors; append them after the brand
// chips so a picker row always offers them without polluting the brand list.
export const NEUTRAL_SWATCHES = ['#FFFFFF', '#000000']

// Relative luminance of a #rrggbb hex (0 = black … 1 = white), or null if invalid.
function hexLum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

// The workspace's darkest / lightest brand color — the SAME derivation the
// renderer uses for template grounds (overlayTemplates.js brandInk/brandPaper),
// so the rail thumbnail diagrams match what actually renders. Falls back to the
// supplied default when the workspace has no brand palette.
export function brandInk(workspace, fallback = '#0c1a2e') {
  const cols = brandSwatches(workspace)
  return cols.length ? cols.reduce((a, b) => (hexLum(b) < hexLum(a) ? b : a)) : fallback
}
export function brandPaper(workspace, fallback = '#f0ede6') {
  const cols = brandSwatches(workspace)
  return cols.length ? cols.reduce((a, b) => (hexLum(b) > hexLum(a) ? b : a)) : fallback
}

// The workspace's karaoke-caption accent — client mirror of the ACCENT chain in
// api/_lib/brandRender.js resolveBrandColors(): colors.accent →
// brand_visual_identity.colorPalette.accent → DEFAULT_ACCENT. The video editor
// seeds caption.accent from this when a draft doesn't already carry one, so the
// stored value the preview styles with is the SAME value the bake receives
// (the server falls back to resolveBrandColors when no valid accent is sent).
// KEEP IN SYNC with resolveBrandColors — a chain change there must land here.
export const WORKSPACE_DEFAULT_ACCENT = '#83957C' // = DEFAULT_ACCENT in brandRender.js
export function workspaceCaptionAccent(workspace) {
  return workspace?.colors?.accent
    || workspace?.brand_visual_identity?.colorPalette?.accent
    || WORKSPACE_DEFAULT_ACCENT
}
