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
