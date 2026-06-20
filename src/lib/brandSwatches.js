// Brand color swatches for the in-app color pickers (template editors, slide
// text styling). Gathers the workspace's palette from the post-#1458 Brand Kit
// structure (brand_kit_style.{primary_colors, secondary_colors, accent_color})
// with graceful fallback to the legacy brand_style.accent_color / colors, so a
// picker can offer one-click "your brand color" chips next to the freeform hex
// picker. Deduped, validated to 6-digit hex, uppercased.

const HEX6 = /^#?[0-9a-fA-F]{6}$/

function normHex(h) {
  if (!h || typeof h !== 'string') return null
  const v = h.trim()
  if (!HEX6.test(v)) return null
  return (v.startsWith('#') ? v : `#${v}`).toUpperCase()
}

/** Ordered, deduped brand hex list (primary → secondary → accent → legacy). */
export function brandSwatches(workspace) {
  const ks = workspace?.brand_kit_style || {}
  const raw = [
    ...(Array.isArray(ks.primary_colors) ? ks.primary_colors : []),
    ...(Array.isArray(ks.secondary_colors) ? ks.secondary_colors : []),
    ks.accent_color,
    workspace?.brand_style?.accent_color,
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
