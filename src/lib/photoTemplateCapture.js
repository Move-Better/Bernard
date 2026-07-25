// Turn a SlideEditor session into a reusable photo template config.
//
// The photo sibling of videoTemplateCapture.js, and the same principle: you
// dial a look in on real slides and promote it, rather than styling in a
// separate template screen. Here it closes a specific gap — the slide editor's
// Text-layer controls are RICHER than the template schema, so a carousel could
// be styled beautifully and none of it was reusable. Every new deck started from
// the template's defaults again.
//
// WHAT CAN AND CANNOT CARRY
//
// roleTypography() in overlayTemplates.js applies the theme block first, then
// lets a per-slide blockStyle override it. Five of those overrides have a
// matching template field, so promoting them changes the default and the
// renderer already honours it with no schema change:
//
//   fontWeight  color  shadow  uppercase   → direct
//   fontScale                              → multiplies the theme's fontSize,
//                                            so it folds into a named size
//
// The rest — font family, italic, underline, lineHeight, letterSpacing, align,
// width, textEffect/effectIntensity/effectColor — have NO template field. They
// are named as skipped rather than dropped quietly, because a template that
// silently loses half your styling is worse than one that says what it took.
//
// KEEP IN SYNC with the block schema in src/lib/photoTemplates.js.

import { FONT_SIZE_PX, resolveTheme } from './photoTemplates.js'

const ROLES = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']

// Per-slide fields the editor can set that a template cannot express.
const UNCAPTURABLE = [
  ['font', 'font family'],
  ['italic', 'italic'],
  ['underline', 'underline'],
  ['lineHeight', 'line height'],
  ['letterSpacing', 'letter spacing'],
  ['align', 'alignment'],
  ['width', 'text box width'],
  ['textEffect', 'text effect'],
  ['effectIntensity', 'effect strength'],
  ['effectColor', 'effect colour'],
]

const SIZE_NAMES = Object.keys(FONT_SIZE_PX)

/** Nearest named size to a pixel value — fontScale is relative, templates are named. */
function nearestSizeName(px) {
  return SIZE_NAMES.reduce((best, name) =>
    Math.abs(FONT_SIZE_PX[name] - px) < Math.abs(FONT_SIZE_PX[best] - px) ? name : best, SIZE_NAMES[0])
}

/** Most common value for a key across blocks — "how you style hooks", not one slide. */
function mode(values) {
  const counts = new Map()
  for (const v of values) {
    if (v === undefined || v === null || v === '') continue
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  if (!counts.size) return undefined
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/**
 * @param {Object} p
 * @param {Array}  p.slides        editor slides (each with blocks[])
 * @param {string} p.themeId       the theme currently applied
 * @param {Array}  p.customThemes  workspace custom templates
 * @returns {{config: object, captured: string[], skipped: string[]}}
 */
export function buildPhotoTemplateFromEditor({ slides = [], themeId, customThemes = [] }) {
  const base = resolveTheme(themeId, customThemes)
  const blocks = {}
  const captured = []
  const skippedKeys = new Set()

  // Every block across every slide, grouped by role.
  const byRole = new Map()
  for (const s of slides) {
    for (const b of s?.blocks || []) {
      if (!b?.role) continue
      if (!byRole.has(b.role)) byRole.set(b.role, [])
      byRole.get(b.role).push(b)
      for (const [key] of UNCAPTURABLE) {
        if (b[key] !== undefined && b[key] !== null && b[key] !== '') skippedKeys.add(key)
      }
    }
  }

  for (const role of ROLES) {
    const themeBlock = base.blocks?.[role]
    if (!themeBlock) continue
    const group = byRole.get(role) || []
    const next = { ...themeBlock }
    const changes = []

    const weight = mode(group.map((b) => b.fontWeight))
    if (weight && weight !== themeBlock.fontWeight) { next.fontWeight = weight; changes.push(weight) }

    const color = mode(group.map((b) => b.color))
    if (color && color !== themeBlock.color) { next.color = color; changes.push(color) }

    const shadow = mode(group.map((b) => b.shadow))
    if (shadow && shadow !== themeBlock.shadow) { next.shadow = shadow; changes.push(`${shadow} shadow`) }

    const upper = mode(group.map((b) => (typeof b.uppercase === 'boolean' ? b.uppercase : undefined)))
    if (upper !== undefined && upper !== themeBlock.uppercase) {
      next.uppercase = upper
      changes.push(upper ? 'uppercase' : 'sentence case')
    }

    // fontScale multiplies the theme's size, so fold it into a named size.
    const scale = mode(group.map((b) => (Number.isFinite(b.fontScale) && b.fontScale > 0 ? b.fontScale : undefined)))
    if (scale && scale !== 1) {
      const px = (FONT_SIZE_PX[themeBlock.fontSize] ?? 44) * scale
      const name = nearestSizeName(px)
      if (name !== themeBlock.fontSize) { next.fontSize = name; changes.push(`size ${name}`) }
    }

    blocks[role] = next
    if (changes.length) captured.push(`${role} — ${changes.join(', ')}`)
  }

  if (!captured.length) {
    captured.push(`Styling matches "${base.name}" — this saves a copy you can diverge from`)
  }

  const skipped = [...skippedKeys]
    .map((k) => UNCAPTURABLE.find(([key]) => key === k)?.[1])
    .filter(Boolean)
  const skippedLines = skipped.length
    ? [`Per-slide only, not part of a template: ${skipped.join(', ')}`]
    : []
  skippedLines.push('Slide text, photos and where text is dragged stay with this story')

  return {
    config: {
      layout: base.layout,
      palette: base.palette,
      blocks,
      ...(base.structure ? { structure: base.structure } : {}),
      ...(base.mode ? { mode: base.mode } : {}),
    },
    captured,
    skipped: skippedLines,
  }
}

/** A name derived from the theme it diverged from, not "Untitled 3". */
export function suggestPhotoTemplateName({ themeId, customThemes = [] }) {
  const base = resolveTheme(themeId, customThemes)
  return `${base.name} (edited)`.slice(0, 80)
}
