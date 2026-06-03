// Text Post Studio (Option B) — pure helpers for building a branded text-only
// post card. The card is a single 1080×1080 slide (no photo) rendered through
// the SAME engine as carousel slides (renderFreeformSlide), then baked to a
// JPEG and attached to the post's media_urls like any other photo.
//
// State shape (also persisted to content_items.text_card for re-editing):
//   { layout, background, headline, subtext, cta, size, position, showName }

import { renderFreeformSlide, SIZE } from '@/lib/overlayTemplates'
import { apiFetch } from '@/lib/api'

const FALLBACK_ACCENT = '#0a7f3f'

// ── Layout registry ─────────────────────────────────────────────────────────
// Each layout seeds defaults (which fields matter, default background, default
// vertical placement). All fields stay editable regardless of layout.
export const LAYOUTS = {
  quote: {
    label: 'Quote / statement', icon: 'quote',
    fields: { subtext: true, cta: false },
    defaults: { background: { preset: 'brand' }, position: 'center', size: 'lg' },
  },
  stat: {
    label: 'Stat / fact', icon: 'bar-chart-3',
    fields: { subtext: true, cta: false },
    defaults: { background: { preset: 'warm' }, position: 'center', size: 'lg' },
  },
  announce: {
    label: 'Announcement', icon: 'megaphone',
    fields: { subtext: true, cta: true },
    defaults: { background: { preset: 'brand' }, position: 'center', size: 'md' },
  },
  cta: {
    label: 'Call to action', icon: 'mouse-pointer-click',
    fields: { subtext: true, cta: true },
    defaults: { background: { preset: 'light' }, position: 'center', size: 'md' },
  },
}
export const LAYOUT_IDS = Object.keys(LAYOUTS)

// Background swatches offered in the editor (brand-aware).
export const BACKGROUND_PRESETS = [
  { id: 'brand', label: 'Brand' },
  { id: 'warm', label: 'Warm' },
  { id: 'light', label: 'Light' },
  { id: 'white', label: 'Minimal' },
]

export const SIZE_OPTIONS = [
  ['sm', 'S'], ['md', 'M'], ['lg', 'L'],
]
const SIZE_FONT = { sm: 'xl', md: '2xl', lg: '3xl' }

export const POSITION_OPTIONS = [
  ['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom'],
]
// Vertical fractions for headline / subtext / cta per anchor.
const POSITION_YS = {
  top:    { head: 0.24, sub: 0.40, cta: 0.56 },
  center: { head: 0.40, sub: 0.56, cta: 0.72 },
  bottom: { head: 0.46, sub: 0.62, cta: 0.80 },
}

export function defaultTextCardState(layout = 'quote') {
  const l = LAYOUTS[layout] || LAYOUTS.quote
  return {
    layout,
    background: { ...l.defaults.background },
    size: l.defaults.size,
    position: l.defaults.position,
    headline: '',
    subtext: '',
    cta: '',
    showName: true,
  }
}

// ── Color helpers (contrast-aware text) ──────────────────────────────────────
function hexLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return 0
  const n = parseInt(m[1], 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}

// Is the card background light enough to need dark text?
export function backgroundIsLight(background, brandStyle) {
  if (!background) return false
  if (background.preset === 'light' || background.preset === 'white') return true
  if (background.preset === 'warm') return false
  if (background.preset === 'brand') return hexLuminance(brandStyle?.accent_color || FALLBACK_ACCENT) > 0.62
  if (background.type === 'solid') return hexLuminance(background.color) > 0.62
  return false
}

// ── Slide + theme construction ────────────────────────────────────────────────
// Build the slide (text blocks at computed positions) for the renderer.
export function buildSlide(state, workspaceName) {
  const fields = (LAYOUTS[state.layout] || LAYOUTS.quote).fields
  const ys = POSITION_YS[state.position] || POSITION_YS.center
  const blocks = []
  if (state.showName && workspaceName) {
    blocks.push({ role: 'page', text: workspaceName, position: { x: 0.5, y: 0.12 } })
  }
  if (state.headline) blocks.push({ role: 'hook', text: state.headline, position: { x: 0.5, y: ys.head } })
  if (fields.subtext && state.subtext) blocks.push({ role: 'body', text: state.subtext, position: { x: 0.5, y: ys.sub } })
  if (fields.cta && state.cta) blocks.push({ role: 'cta', text: state.cta, position: { x: 0.5, y: ys.cta } })
  return { template: 'custom', blocks }
}

// Build a contrast-correct theme for the chosen background. We do NOT reuse the
// carousel themes here because those assume a photo + dark overlay (white text);
// a light/white card needs dark text. This keeps text legible on any background.
export function buildTextCardTheme(state, brandStyle) {
  const light = backgroundIsLight(state.background, brandStyle)
  const fg = light ? '#1c1917' : '#ffffff'
  const sub = light ? 'rgba(28,25,23,0.74)' : 'rgba(255,255,255,0.84)'
  const muted = light ? 'rgba(28,25,23,0.55)' : 'rgba(255,255,255,0.6)'
  return {
    blocks: {
      page: { fontSize: 'xs', fontWeight: 'semibold', color: muted, shadow: light ? 'none' : 'soft', background: 'none', bgColor: null, uppercase: true },
      hook: { fontSize: SIZE_FONT[state.size] || '2xl', fontWeight: 'extrabold', color: fg, shadow: light ? 'none' : 'soft', background: 'none', bgColor: null, uppercase: false },
      body: { fontSize: 'base', fontWeight: 'medium', color: sub, shadow: light ? 'none' : 'soft', background: 'none', bgColor: null, uppercase: false },
      // CTA pill: on a light card use the brand accent fill (white text); on a
      // dark card a subtle translucent white pill keeps it readable.
      cta: { fontSize: 'base', fontWeight: 'bold', color: light ? '#ffffff' : fg, shadow: 'none', background: 'pill', bgColor: light ? null : 'rgba(255,255,255,0.18)', uppercase: false },
    },
  }
}

// ── Render + bake ─────────────────────────────────────────────────────────────
export async function renderTextCard({ state, brandStyle, workspaceName, canvas }) {
  const slide = buildSlide(state, workspaceName)
  const theme = buildTextCardTheme(state, brandStyle)
  const target = canvas || document.createElement('canvas')
  target.width = SIZE
  target.height = SIZE
  await renderFreeformSlide({
    sourceUrl: null,
    slide,
    brandStyle: brandStyle || {},
    canvas: target,
    theme,
    background: state.background,
  })
  return target
}

// Stable short hash of the state → render signature for idempotent uploads.
function stateSig(state) {
  const str = JSON.stringify(state)
  let h1 = 0xdeadbeef ^ str.length
  let h2 = 0x41c6ce57 ^ str.length
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return ((h2 >>> 0).toString(16) + (h1 >>> 0).toString(16)).slice(0, 16)
}

// Render the card, bake to JPEG, upload to Blob (reusing the carousel slide
// endpoint), and return the public URL. idx 0 = the single text card.
export async function bakeTextCard({ pieceId, state, brandStyle, workspaceName }) {
  const canvas = await renderTextCard({ state, brandStyle, workspaceName })
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const { url } = await apiFetch('/api/editorial/upload-slide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pieceId, idx: 0, sig: stateSig(state), dataUrl }),
  })
  if (!url) throw new Error('Text card upload returned no URL')
  return url
}
