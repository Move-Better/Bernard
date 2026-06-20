// Photo template system — shared by the carousel slide editor and single-photo
// composer. Six named templates across three layout families × light/dark palettes:
//
//   dark-claim  / light-claim  — full-bleed claim card (works with or without photo)
//   dark-badge  / light-badge  — dark/bright photo + headline bottom-anchored
//   dark-split  / light-split  — photo top half, solid panel bottom half
//
// Shared WHOOP brand DNA: deep navy (#0c1a2e) as the dark ground, one orange
// accent on the CTA (bgColor:null → workspace brand_style.accent_color), sage
// (#83957c) for small uppercase tracked labels, extrabold sentence-case headlines.
//
// Config shape per block role:
//   fontSize:   'xs'|'sm'|'base'|'lg'|'xl'|'2xl'|'3xl'
//   fontWeight: 'normal'|'medium'|'semibold'|'bold'|'extrabold'
//   color:      CSS color string
//   shadow:     'none'|'soft'|'medium'|'strong'
//   background: 'none'|'pill'|'rect'
//   bgColor:    CSS color string | null  (null = use brand accent for pill/rect)
//   uppercase:  boolean

// Maps named sizes to canvas px on a 1080×1080 canvas.
export const FONT_SIZE_PX = {
  xs:    28,
  sm:    36,
  base:  44,
  lg:    56,
  xl:    72,
  '2xl': 84,
  '3xl': 100,
}

// Maps named weights to CSS/canvas weight strings.
export const FONT_WEIGHT_CSS = {
  normal:    '400',
  medium:    '500',
  semibold:  '600',
  bold:      '700',
  extrabold: '800',
}

// Defaults used when a theme omits a block role entirely.
const FALLBACK_BLOCK = {
  fontSize: 'base', fontWeight: 'semibold', color: '#ffffff',
  shadow: 'medium', background: 'none', bgColor: null, uppercase: false,
}

// ── Palette constants ────────────────────────────────────────────────────────

const NAVY        = '#0c1a2e'
const SAGE        = '#83957c'
const PAPER       = 'rgba(246,244,239,0.95)'
const PAPER2      = 'rgba(246,244,239,0.90)'
const SAGE_PANEL  = 'rgba(234,238,234,0.92)'
const NAVY_PANEL  = 'rgba(12,26,46,0.94)'

// ── Built-in themes ─────────────────────────────────────────────────────────
//
// IDs are stable — stories reference them by id, never rename them.
// Names + block style values may change freely.

// ── Structure primitive vocabulary ──────────────────────────────────────────
//
// Each theme's `structure` field is an ordered list of drawing primitives that
// replace the hardcoded `drawWhoopLayout` switch. The renderer in
// overlayTemplates.js interprets them generically.
//
// Color values may be:
//   '$ink'   → brandInk(brandStyle)       (workspace darkest brand color)
//   '$paper' → brandPaper(brandStyle)     (workspace lightest brand color)
//   '$accent'→ brandAccent(brandStyle)    (workspace accent color)
//   { token: '$ink'|'$paper'|'$accent', fallback?: string, lighten?: number }
//   Any literal CSS color string
//
// Primitive types:
//   bg-solid       { color }
//   bg-radial      { colorCenter, colorEdge, x0Frac, y0Frac, r0, x1Frac, y1Frac, r1Frac }
//                  — simplified model form: { colorCenter, colorEdge, yCenterFrac? }
//   bg-linear      { colorFrom, colorTo }
//   photo          { fallback? }                  — draws source photo; fallback when none
//   overlay        { color }                      — full-canvas solid overlay
//   scrim          { yFrac, yEndFrac, stops }     — explicit stop array
//                  — simplified model form: { yFrac, yEndFrac?, opacity? }
//   panel          { color, yFrac }               — solid rect from yFrac to bottom
//   gradient-panel { colorFrom, colorTo, yFrac }  — gradient rect from yFrac to bottom
//   rule           { color, yFrac, thickness, padded } — horizontal accent line
//   circle         { color, cxFrac, cyFrac, rFrac }   — filled circle (decorative)
//
// Theme-level:
//   mode: 'post' (default) | 'ad'   — 'ad' skips text block rendering (clean background)

export const BUILTIN_THEMES = {

  // ── FULL PHOTO ── clean full-bleed photo, text overlaid (the default)
  //   The photo owns the whole slide; edge scrims (stronger bottom, light top)
  //   keep overlaid text legible without dimming the photo. "The photo is the
  //   photo" — zoom/reposition to frame it. Default deck theme for carousels.
  //   (U2.1b, Q sign-off mockups/photo-experience-v1.html 2026-06-20.)
  'photo-dark': {
    id: 'photo-dark', name: 'Full Photo', builtin: true,
    layout: 'photo', palette: 'dark',
    structure: [
      { type: 'photo', fallback: { type: 'bg-linear', colorFrom: { token: '$ink', fallback: '#1e293b', lighten: 0.28 }, colorTo: { token: '$ink', fallback: '#1e293b' } } },
      { type: 'scrim', yFrac: 0.50, yEndFrac: 1.0,  stops: [[0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0.42)'], [1.0, 'rgba(0,0,0,0.74)']] },
      { type: 'scrim', yFrac: 0.0,  yEndFrac: 0.22, stops: [[0, 'rgba(0,0,0,0.34)'], [1.0, 'rgba(0,0,0,0)']] },
    ],
    blocks: {
      hook:        { fontSize: '2xl',  fontWeight: 'extrabold', color: '#ffffff',               shadow: 'strong', background: 'none',  bgColor: null,        uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.85)', shadow: 'medium', background: 'none',  bgColor: null,        uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.72)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'semibold',  color: 'rgba(255,255,255,0.85)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: 'rgba(255,255,255,0.78)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── DARK-CLAIM ── editorial card, strong dark ground, brand font
  //   Full-bleed dark (brand ink) radial-gradient ground. Works with or without
  //   a source photo. Orange rule + sage label above the headline.
  'dark-claim': {
    id: 'dark-claim', name: 'Dark Claim', builtin: true,
    layout: 'claim', palette: 'dark',
    structure: [
      { type: 'bg-radial', colorCenter: { token: '$ink', lighten: 0.13 }, colorEdge: '$ink', x0Frac: 0.5, y0Frac: 0.42, r0: 0, x1Frac: 0.5, y1Frac: 0.5, r1Frac: 0.72 },
      { type: 'rule', color: '$accent', yFrac: 0.11, thickness: 4, padded: true },
    ],
    blocks: {
      hook:        { fontSize: '2xl',  fontWeight: 'extrabold', color: '#ffffff',               shadow: 'strong', background: 'none',  bgColor: null,        uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.72)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.55)', shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'semibold',  color: 'rgba(255,255,255,0.82)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: 'rgba(255,255,255,0.65)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── LIGHT-CLAIM ── editorial card, paper ground, navy text
  //   Warm cream (brand paper) background. Headline + body in navy, orange rule
  //   above headline, sage for the label. CTA pill in brand accent.
  'light-claim': {
    id: 'light-claim', name: 'Light Claim', builtin: true,
    layout: 'claim', palette: 'light',
    structure: [
      { type: 'bg-solid', color: '$paper' },
      { type: 'rule', color: '$accent', yFrac: 0.11, thickness: 4, padded: true },
    ],
    blocks: {
      hook:        { fontSize: 'xl',   fontWeight: 'extrabold', color: NAVY,                    shadow: 'none',   background: 'rect',  bgColor: PAPER,       uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: '#475569',               shadow: 'none',   background: 'rect',  bgColor: PAPER2,      uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'normal',    color: '#64748b',               shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'semibold',  color: NAVY,                    shadow: 'none',   background: 'rect',  bgColor: PAPER,       uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: SAGE,                    shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── DARK-BADGE ── full-bleed dark photo, scrim-anchored headline
  //   Photo covers the frame; a gradient scrim grounds the headline at the bottom.
  //   Orange rule + sage label above the hook. Metric / badge lives in the compositor.
  'dark-badge': {
    id: 'dark-badge', name: 'Dark Badge', builtin: true,
    layout: 'badge', palette: 'dark',
    structure: [
      { type: 'photo', fallback: { type: 'bg-solid', color: '$ink' } },
      { type: 'overlay', color: 'rgba(0,0,0,0.30)' },
      { type: 'scrim', yFrac: 0.48, yEndFrac: 1.0, stops: [[0, 'rgba(0,0,0,0)'], [0.45, 'rgba(0,0,0,0.80)'], [1.0, 'rgba(0,0,0,0.97)']] },
      { type: 'rule', color: '$accent', yFrac: 0.57, thickness: 4, padded: true },
    ],
    blocks: {
      hook:        { fontSize: 'xl',   fontWeight: 'extrabold', color: '#ffffff',               shadow: 'strong', background: 'none',  bgColor: null,        uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.80)', shadow: 'medium', background: 'none',  bgColor: null,        uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.68)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'sm',   fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.75)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: 'rgba(255,255,255,0.62)', shadow: 'soft',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── LIGHT-BADGE ── bright photo, clean panel, metric badge at seam
  //   Photo occupies the upper ~58%; white panel the lower ~42% (translucent,
  //   photo ghosting through). Headline in navy on the panel; CTA in brand accent.
  'light-badge': {
    id: 'light-badge', name: 'Light Badge', builtin: true,
    layout: 'badge', palette: 'light',
    structure: [
      { type: 'photo', fallback: { type: 'bg-linear', colorFrom: { token: '$paper', fallback: '#cbd5e1', lighten: 0.06 }, colorTo: { token: '$paper', fallback: '#cbd5e1', lighten: -0.08 } } },
      { type: 'scrim',  yFrac: 0.40, yEndFrac: 0.58, stops: [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(255,255,255,0.612)'], [1.0, 'rgba(255,255,255,0.72)']] },
      { type: 'panel',  color: 'rgba(255,255,255,0.72)', yFrac: 0.58 },
      { type: 'rule',   color: '$accent', yFrac: 0.58, thickness: 4, padded: false },
    ],
    blocks: {
      hook:        { fontSize: 'lg',   fontWeight: 'extrabold', color: NAVY,                    shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: '#475569',               shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'normal',    color: '#64748b',               shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'semibold',  color: NAVY,                    shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: SAGE,                    shadow: 'none',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── DARK-SPLIT ── photo top ~67%, brand-ink panel below
  //   Full-bleed photo base; solid brand panel overlays the bottom third.
  //   Orange rule at the seam. Headline in white on the panel.
  'dark-split': {
    id: 'dark-split', name: 'Dark Split', builtin: true,
    layout: 'split', palette: 'dark',
    structure: [
      { type: 'photo', fallback: { type: 'bg-linear', colorFrom: { token: '$ink', fallback: '#1e293b', lighten: 0.28 }, colorTo: { token: '$ink', fallback: '#1e293b' } } },
      { type: 'panel', color: '$ink', yFrac: 0.67 },
      { type: 'rule',  color: '$accent', yFrac: 0.67, thickness: 4, padded: false },
    ],
    blocks: {
      hook:        { fontSize: 'lg',   fontWeight: 'extrabold', color: '#ffffff',               shadow: 'none',   background: 'rect',  bgColor: NAVY_PANEL,  uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: 'rgba(255,255,255,0.75)', shadow: 'none',   background: 'rect',  bgColor: NAVY_PANEL,  uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.60)', shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'sm',   fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'normal',    color: 'rgba(255,255,255,0.72)', shadow: 'none',   background: 'rect',  bgColor: NAVY_PANEL,  uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: 'rgba(255,255,255,0.58)', shadow: 'none',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },

  // ── LIGHT-SPLIT ── photo top ~67%, sage-green panel below
  //   Same split geometry; brand-paper panel instead of ink. Navy text. Softer,
  //   editorial feel for health + wellness brands.
  'light-split': {
    id: 'light-split', name: 'Light Split', builtin: true,
    layout: 'split', palette: 'light',
    structure: [
      { type: 'photo', fallback: { type: 'bg-linear', colorFrom: { token: '$ink', fallback: '#1e293b', lighten: 0.28 }, colorTo: { token: '$ink', fallback: '#1e293b' } } },
      { type: 'panel', color: { token: '$paper', fallback: '#eaeeea' }, yFrac: 0.67 },
      { type: 'rule',  color: '$accent', yFrac: 0.67, thickness: 4, padded: false },
    ],
    blocks: {
      hook:        { fontSize: 'lg',   fontWeight: 'bold',      color: NAVY,                    shadow: 'none',   background: 'rect',  bgColor: SAGE_PANEL,  uppercase: false },
      body:        { fontSize: 'sm',   fontWeight: 'medium',    color: '#475569',               shadow: 'none',   background: 'rect',  bgColor: SAGE_PANEL,  uppercase: false },
      caption:     { fontSize: 'xs',   fontWeight: 'normal',    color: '#64748b',               shadow: 'none',   background: 'none',  bgColor: null,        uppercase: false },
      cta:         { fontSize: 'base', fontWeight: 'bold',      color: '#ffffff',               shadow: 'none',   background: 'pill',  bgColor: null,        uppercase: false },
      attribution: { fontSize: 'xs',   fontWeight: 'semibold',  color: NAVY,                    shadow: 'none',   background: 'rect',  bgColor: SAGE_PANEL,  uppercase: false },
      page:        { fontSize: 'xs',   fontWeight: 'bold',      color: SAGE,                    shadow: 'none',   background: 'none',  bgColor: null,        uppercase: true  },
    },
  },
}

export const BUILTIN_THEME_IDS = Object.keys(BUILTIN_THEMES)

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The default deck theme for a carousel with no explicit photo_template_id — a
 *  clean full-bleed photo. Shared by the editor (themeId init + dirty baseline)
 *  AND the publish bake, so a null deck resolves identically everywhere
 *  (preview == publish). (U2.1b — Q sign-off 2026-06-20) */
export const DEFAULT_DECK_THEME = 'photo-dark'

/** Resolve a template ID (built-in slug or custom UUID) to a theme object.
 *  Falls back to the default deck theme (Full Photo) if nothing matches. */
export function resolveTheme(themeId, customThemes = []) {
  if (!themeId) return BUILTIN_THEMES[DEFAULT_DECK_THEME]
  if (BUILTIN_THEMES[themeId]) return BUILTIN_THEMES[themeId]
  const custom = customThemes.find((t) => t.id === themeId)
  if (custom) return custom
  return BUILTIN_THEMES[DEFAULT_DECK_THEME]
}

/** Return the style config for a specific role within a resolved theme. */
export function themeBlockConfig(theme, role) {
  return theme?.blocks?.[role] || BUILTIN_THEMES['dark-split'].blocks[role] || FALLBACK_BLOCK
}

/** Default block config used in the settings editor form when creating a new template. */
export function defaultBlockConfig(role) {
  return BUILTIN_THEMES['dark-split'].blocks[role] || FALLBACK_BLOCK
}

/** All themes in display order: built-ins first, then custom. */
export function mergeThemes(customThemes = []) {
  return [...Object.values(BUILTIN_THEMES), ...customThemes]
}

/** Which family a template belongs to, for the two-group picker:
 *   'text'  — a branded card with NO photo (the Claim layouts; deliberate).
 *   'photo' — full-bleed photo with the brand design overlaid on top.
 *  Built-ins derive from layout (claim = text-only); a template may also declare
 *  `family` explicitly (e.g. a custom workspace template). (Q 2026-06-20) */
export function templateFamily(theme) {
  if (theme?.family === 'text' || theme?.family === 'photo') return theme.family
  return theme?.layout === 'claim' ? 'text' : 'photo'
}
