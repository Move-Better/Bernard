// Canvas overlay template registry.
//
// Each template is a function that draws a single 1080x1080 slide onto a
// canvas 2D context. Templates differ in layout (where text sits, how the
// photo is treated, what brand color shows up where) and in which emphasis
// types they support (hook / subhead / cta / combined).
//
// The Claude design-picker endpoint introspects TEMPLATE_DESCRIPTIONS to
// decide which template to use per slide; the ReviewPost compose flow then
// calls renderSlide() with the picker's output.
//
// To add a new template:
//   1. Add a render function below.
//   2. Register it in TEMPLATES with { supports, description }.
//   3. Add to TEMPLATE_DESCRIPTIONS for the picker prompt.
//   4. Bannerbear migration later: same picker JSON → Bannerbear modifications.

export const SIZE = 1080
// Carousel slide output is 4:5 portrait (1080×1350) — more feed space, the
// modern carousel standard. The renderer is aspect-parametric (renderFreeformSlide
// width/height + drawWhoopLayout W/H), so 1:1 / 9:16 are just different dims passed
// by the caller. (Q 2026-06-20)
export const SLIDE_W = SIZE
export const SLIDE_H = Math.round(SIZE * 1.25)
const FALLBACK_ACCENT  = '#0a7f3f'
const FALLBACK_HEADING = '"Inter", "Helvetica Neue", Arial, sans-serif'
const FALLBACK_BODY    = '"Inter", "Helvetica Neue", Arial, sans-serif'

function brandFonts(brandStyle) {
  const heading = brandStyle?.heading_font ? `"${brandStyle.heading_font}", ${FALLBACK_HEADING}` : FALLBACK_HEADING
  const body    = brandStyle?.body_font    ? `"${brandStyle.body_font}", ${FALLBACK_BODY}`       : FALLBACK_BODY
  return { heading, body }
}

function brandAccent(brandStyle, fallback = FALLBACK_ACCENT) {
  return brandStyle?.accent_color || fallback
}

// Relative luminance of a #rrggbb hex (0 = black … 1 = white), or null if invalid.
function hexLum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

// Every valid brand palette color from the workspace Brand Kit (stored on the
// brand_style JSONB: primary_colors + secondary_colors + accent_color).
function brandPaletteColors(brandStyle) {
  return [
    ...(Array.isArray(brandStyle?.primary_colors) ? brandStyle.primary_colors : []),
    ...(Array.isArray(brandStyle?.secondary_colors) ? brandStyle.secondary_colors : []),
    brandStyle?.accent_color,
  ].filter((c) => hexLum(c) != null)
}

// The brand's darkest / lightest palette color — used for template grounds so a
// "dark" template uses the workspace's OWN dark color, not a hardcoded navy.
// Falls back to the supplied WHOOP default ONLY when the workspace has no usable
// brand palette, so tenants without a Brand Kit keep the original look and no
// off-brand color is ever invented.
function brandInk(brandStyle, fallback) {
  const cols = brandPaletteColors(brandStyle)
  return cols.length ? cols.reduce((a, b) => (hexLum(b) < hexLum(a) ? b : a)) : fallback
}
function brandPaper(brandStyle, fallback) {
  const cols = brandPaletteColors(brandStyle)
  return cols.length ? cols.reduce((a, b) => (hexLum(b) > hexLum(a) ? b : a)) : fallback
}

// Darken (amt < 0) or lighten (amt > 0) a #rrggbb hex by a fraction. Used to
// derive a gradient end-stop from the brand accent. Returns input unchanged if
// it isn't a 6-digit hex.
function shadeHex(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = amt < 0 ? 1 + amt : 1 - amt
  const add = amt > 0 ? Math.round(255 * amt) : 0
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f) + add)
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f) + add)
  const b = Math.min(255, Math.round((n & 255) * f) + add)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// Paint a non-photo background for text-only cards (Text Post Studio). `bg` is:
//   { preset: 'brand'|'warm'|'light'|'white' }  — named, brand-aware
//   { type: 'solid', color }                    — explicit solid
//   { type: 'gradient', from, to }              — explicit vertical gradient
// 'brand' derives a vertical gradient from the workspace accent color.
function paintCardBackground(ctx, bg, brandStyle) {
  let solid = null
  let from = null
  let to = null
  if (bg.preset) {
    const accent = brandAccent(brandStyle)
    switch (bg.preset) {
      case 'brand': from = accent; to = shadeHex(accent, -0.4); break
      case 'warm':  from = '#c2570f'; to = '#e8852e'; break
      case 'light': from = '#fde9d2'; to = '#f6dcc0'; break
      case 'white': solid = '#ffffff'; break
      default:      from = '#475569'; to = '#1e293b'
    }
  } else if (bg.type === 'solid') {
    solid = bg.color || '#1e293b'
  } else if (bg.type === 'gradient') {
    from = bg.from || '#475569'
    to = bg.to || '#1e293b'
  } else {
    from = '#475569'; to = '#1e293b'
  }
  if (solid) {
    ctx.fillStyle = solid
    ctx.fillRect(0, 0, SIZE, SIZE)
    return
  }
  const grad = ctx.createLinearGradient(0, 0, 0, SIZE)
  grad.addColorStop(0, from)
  grad.addColorStop(1, to)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SIZE, SIZE)
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      if (lines.length >= maxLines) { line = ''; break }
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2)
  ctx.closePath()
}

// Draw source image object-cover into a region. Assumes the image element is
// already loaded (callers pre-load with crossOrigin='anonymous').
// Draw `img` to fully cover the (x,y,w,h) frame. `zoom` (>=1) crops in for a
// tighter framing; `offset` {x,y} in -0.5..0.5 pans the focal point (fraction of
// the overflow on each axis). The result is clamped so the frame always stays
// fully covered — panning can never reveal an empty edge. Defaults (zoom 1, no
// offset) reproduce the historical centered cover exactly, so existing callers
// are byte-identical.
function drawCover(ctx, img, x, y, w, h, zoom = 1, offset = null) {
  const z = zoom > 0 ? zoom : 1
  const scale = Math.max(w / img.width, h / img.height) * z
  const sw = img.width  * scale
  const sh = img.height * scale
  const ox = offset && Number.isFinite(offset.x) ? offset.x : 0
  const oy = offset && Number.isFinite(offset.y) ? offset.y : 0
  let dx = x + (w - sw) / 2 + ox * (sw - w)
  let dy = y + (h - sh) / 2 + oy * (sh - h)
  // Clamp to keep the frame covered (sw>=w and sh>=h by construction).
  dx = Math.min(x, Math.max(x + w - sw, dx))
  dy = Math.min(y, Math.max(y + h - sh, dy))
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, dx, dy, sw, sh)
  ctx.restore()
}

// Draw a photo into (x,y,w,h) framed by the user's zoom (relative to FIT) + pan.
//   zoom = 1            → the WHOLE photo fits inside the frame (default)
//   zoom = cover/fit    → the photo just covers the frame
//   zoom > cover/fit    → cropped in tighter
// When the photo doesn't cover the frame, a blurred enlarged copy of the SAME
// photo fills the gaps (Instagram-style) so it always looks intentional. Honours
// any colorist filter already set on ctx.filter for the sharp photo. (Q 2026-06-20)
function drawPhotoFit(ctx, img, x, y, w, h, zoom = 1, offset = null) {
  const z = zoom > 0 ? zoom : 1
  const fitScale   = Math.min(w / img.width, h / img.height)
  const coverScale = Math.max(w / img.width, h / img.height)
  const scale = fitScale * z
  const sw = img.width * scale, sh = img.height * scale
  const ox = offset && Number.isFinite(offset.x) ? offset.x : 0
  const oy = offset && Number.isFinite(offset.y) ? offset.y : 0
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  if (sw < w - 0.5 || sh < h - 0.5) {
    // Doesn't fill the frame → blurred cover backdrop fills the gaps, sharp photo on top.
    const base = ctx.filter && ctx.filter !== 'none' ? ctx.filter + ' ' : ''
    const bs = coverScale * 1.12           // slight overscan so blurred edges clear the clip
    const bw = img.width * bs, bh = img.height * bs
    ctx.filter = base + 'blur(34px)'
    ctx.drawImage(img, x + (w - bw) / 2, y + (h - bh) / 2, bw, bh)
    ctx.filter = base || 'none'
    let dx = x + (w - sw) / 2 + ox * (w - sw)   // pan the photo within the empty slack
    let dy = y + (h - sh) / 2 + oy * (h - sh)
    dx = Math.max(x, Math.min(x + w - sw, dx))
    dy = Math.max(y, Math.min(y + h - sh, dy))
    ctx.drawImage(img, dx, dy, sw, sh)
  } else {
    // Covers the frame → pan within the overflow, clamped so no empty edge shows.
    let dx = x + (w - sw) / 2 + ox * (sw - w)
    let dy = y + (h - sh) / 2 + oy * (sh - h)
    dx = Math.min(x, Math.max(x + w - sw, dx))
    dy = Math.min(y, Math.max(y + h - sh, dy))
    ctx.drawImage(img, dx, dy, sw, sh)
  }
  ctx.restore()
}

// ── Template renderers ──────────────────────────────────────────────────────
// Each takes (ctx, { img, text, brandStyle, options }) where:
//   img         — pre-loaded HTMLImageElement
//   text        — string to render (one of hook/subhead/cta) for solo templates,
//                 or { hook, subhead, cta } object for combined templates
//   brandStyle  — workspace.brand_style JSONB
//   options     — picker's adjustments: { photoDim, colorChoice, textAlign }

function renderBoldCentered(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  const dim = options?.photoDim ?? 0.5
  ctx.fillStyle = `rgba(0,0,0,${dim})`
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD = 80
  const isHook = options?.emphasis === 'hook'
  const display = isHook ? text.toUpperCase() : text
  const { heading } = brandFonts(brandStyle)

  ctx.font         = `bold ${isHook ? 96 : 64}px ${heading}`
  ctx.fillStyle    = 'white'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 110 : 78
  const lines = wrapLines(ctx, display, SIZE - PAD * 2, isHook ? 4 : 5)
  let y = (SIZE - lines.length * lineH) / 2 + lineH * 0.75
  for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
  ctx.textAlign = 'start'
}

function renderSplitBlock(ctx, { img, text, brandStyle, options }) {
  // Photo top half, brand-color block bottom with text
  const photoH = Math.round(SIZE * 0.55)
  drawCover(ctx, img, 0, 0, SIZE, photoH)

  const accent  = brandAccent(brandStyle)
  const useColor = options?.colorChoice === 'white' ? '#ffffff' : accent
  const textColor = options?.colorChoice === 'white' ? '#0f172a' : '#ffffff'
  ctx.fillStyle = useColor
  ctx.fillRect(0, photoH, SIZE, SIZE - photoH)

  const PAD = 64
  const blockH = SIZE - photoH
  const isHook = options?.emphasis === 'hook'
  const { heading } = brandFonts(brandStyle)
  const display = isHook ? text.toUpperCase() : text

  ctx.font         = `bold ${isHook ? 72 : 52}px ${heading}`
  ctx.fillStyle    = textColor
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 82 : 64
  const lines = wrapLines(ctx, display, SIZE - PAD * 2, 4)
  const totalH = lines.length * lineH
  let y = photoH + (blockH - totalH) / 2 + lineH * 0.75
  for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
}

function renderMinimalCorner(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)

  // Light dim only on the band where the text sits
  const PAD = 72
  const { heading } = brandFonts(brandStyle)
  const isHook = options?.emphasis === 'hook'
  const display = isHook ? text.toUpperCase() : text
  ctx.font = `bold ${isHook ? 64 : 46}px ${heading}`
  ctx.textBaseline = 'alphabetic'

  const lineH = isHook ? 76 : 58
  const lines = wrapLines(ctx, display, SIZE - PAD * 2 - 80, 3)
  const bandH = lines.length * lineH + PAD

  // Gradient band on bottom for legibility
  const grad = ctx.createLinearGradient(0, SIZE - bandH * 1.2, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.78)')
  ctx.fillStyle = grad
  ctx.fillRect(0, SIZE - bandH * 1.3, SIZE, bandH * 1.3)

  ctx.fillStyle = 'white'
  let y = SIZE - PAD - (lines.length - 1) * lineH
  for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
}

function renderCtaPill(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)

  // Gentle bottom gradient
  const grad = ctx.createLinearGradient(0, SIZE * 0.55, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SIZE, SIZE)

  const accent = brandAccent(brandStyle)
  const useAccent = options?.colorChoice !== 'white'
  const pillFill   = useAccent ? accent : '#ffffff'
  const pillText   = useAccent ? '#ffffff' : '#0f172a'

  const PAD = 80
  const { heading } = brandFonts(brandStyle)
  ctx.font = `bold 56px ${heading}`
  ctx.textBaseline = 'middle'
  ctx.textAlign    = 'center'

  const textW = ctx.measureText(text).width
  const pillW = Math.min(textW + 96, SIZE - PAD * 2)
  const pillH = 100
  const pillX = (SIZE - pillW) / 2
  const pillY = SIZE - PAD - pillH

  ctx.fillStyle = pillFill
  drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.fill()

  ctx.fillStyle = pillText
  ctx.fillText(text, SIZE / 2, pillY + pillH / 2)
  ctx.textAlign = 'start'
}

// Combined templates — render hook + subhead + cta together
function renderBottomStack(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  const grad = ctx.createLinearGradient(0, SIZE * 0.45, 0, SIZE)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, `rgba(0,0,0,${options?.photoDim ?? 0.8})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD  = 72
  const maxW = SIZE - PAD * 2
  const { heading, body } = brandFonts(brandStyle)
  const accent = brandAccent(brandStyle)
  let bottomY = SIZE - PAD

  // CTA pill
  if (text.cta) {
    ctx.font = `bold 34px ${heading}`
    ctx.textBaseline = 'middle'
    const useAccent = options?.colorChoice === 'accent'
    const pillFill = useAccent ? accent : 'rgba(255,255,255,0.18)'
    const pillStroke = useAccent ? accent : 'rgba(255,255,255,0.45)'
    const pillTextColor = useAccent ? 'white' : 'white'
    const pillW = Math.min(ctx.measureText(text.cta).width + 64, maxW)
    const pillH = 54
    const pillY = bottomY - pillH
    ctx.fillStyle = pillFill
    ctx.strokeStyle = pillStroke
    ctx.lineWidth = 2
    drawRoundedRect(ctx, PAD, pillY, pillW, pillH, pillH / 2)
    ctx.fill()
    if (!useAccent) ctx.stroke()
    ctx.fillStyle = pillTextColor
    ctx.fillText(text.cta, PAD + 32, pillY + pillH / 2)
    bottomY = pillY - 28
  }

  // Subhead
  if (text.subhead) {
    ctx.font = `400 38px ${body}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    const lines = wrapLines(ctx, text.subhead, maxW, 2)
    const lineH = 52
    bottomY -= lines.length * lineH
    let y = bottomY
    for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
    bottomY -= 24
  }

  // Hook
  if (text.hook) {
    ctx.font = `bold 68px ${heading}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'white'
    const lines = wrapLines(ctx, text.hook.toUpperCase(), maxW, 2)
    const lineH = 84
    bottomY -= lines.length * lineH
    let y = bottomY
    for (const l of lines) { ctx.fillText(l, PAD, y); y += lineH }
  }
}

function renderCenteredDramatic(ctx, { img, text, brandStyle, options }) {
  drawCover(ctx, img, 0, 0, SIZE, SIZE)
  ctx.fillStyle = `rgba(0,0,0,${options?.photoDim ?? 0.6})`
  ctx.fillRect(0, 0, SIZE, SIZE)

  const PAD = 80
  const maxW = SIZE - PAD * 2
  const { heading, body } = brandFonts(brandStyle)
  const accent = brandAccent(brandStyle)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // Vertical layout: hook (center-top), subhead (center-mid), cta pill (center-low)
  let y = SIZE / 2 - 160

  if (text.hook) {
    ctx.font = `bold 84px ${heading}`
    ctx.fillStyle = 'white'
    const lines = wrapLines(ctx, text.hook.toUpperCase(), maxW, 3)
    const lineH = 96
    y -= (lines.length - 1) * lineH / 2
    for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
    y += 24
  }

  if (text.subhead) {
    ctx.font = `400 40px ${body}`
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    const lines = wrapLines(ctx, text.subhead, maxW, 2)
    const lineH = 56
    for (const l of lines) { ctx.fillText(l, SIZE / 2, y); y += lineH }
    y += 36
  }

  if (text.cta) {
    ctx.font = `bold 38px ${heading}`
    ctx.textBaseline = 'middle'
    const pillFill = accent
    const pillW = Math.min(ctx.measureText(text.cta).width + 64, maxW)
    const pillH = 64
    const pillX = (SIZE - pillW) / 2
    ctx.fillStyle = pillFill
    drawRoundedRect(ctx, pillX, y, pillW, pillH, pillH / 2)
    ctx.fill()
    ctx.fillStyle = 'white'
    ctx.fillText(text.cta, SIZE / 2, y + pillH / 2)
  }
  ctx.textAlign = 'start'
}

// ── Registry ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  bold_centered: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderBoldCentered,
  },
  split_block: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderSplitBlock,
  },
  minimal_corner: {
    supports: ['hook', 'subhead', 'cta'],
    combined: false,
    render: renderMinimalCorner,
  },
  cta_pill: {
    supports: ['cta'],
    combined: false,
    render: renderCtaPill,
  },
  bottom_stack: {
    supports: ['combined'],
    combined: true,
    render: renderBottomStack,
  },
  centered_dramatic: {
    supports: ['combined'],
    combined: true,
    render: renderCenteredDramatic,
  },
}

// Plain-text descriptions for the Claude picker prompt. Keep short — the model
// only needs enough to make a sensible choice. Layout details are abstracted
// to "what it looks like + when to use it" rather than pixel specifics.
export const TEMPLATE_DESCRIPTIONS = {
  bold_centered:     'Photo darkened, single line of large bold text centered. Strong for hook/myth-buster posts. Works on any photo.',
  split_block:       'Photo top half, solid-color block (brand accent or white) bottom half with bold text. Editorial feel. Works when photo subject is in the top half.',
  minimal_corner:    'Photo full-bleed with subtle gradient at bottom, smaller text bottom-left. Use when the photo is the message and text supports it.',
  cta_pill:          'Full-bleed photo with prominent brand-color CTA pill button centered low. CTA-only slides.',
  bottom_stack:      'All three elements stacked at bottom with gradient — hook (largest), subhead, CTA pill. The classic combined layout.',
  centered_dramatic: 'All three elements centered vertically, heavier photo dim, accent-color CTA pill. High-impact "stop scrolling" combined layout.',
}

// Human-readable labels for the customize panel dropdown.
export const TEMPLATE_LABELS = {
  bold_centered:     'Bold centered',
  split_block:       'Split block',
  minimal_corner:    'Minimal corner',
  cta_pill:          'CTA pill',
  bottom_stack:      'Bottom stack',
  centered_dramatic: 'Centered dramatic',
}

// Returns template ids compatible with a given emphasis (one of
// 'hook' | 'subhead' | 'cta' | 'combined'). Used by the customize panel
// to populate the template dropdown for each composed slide.
export function getCompatibleTemplates(emphasis) {
  const isCombined = emphasis === 'combined'
  return Object.entries(TEMPLATES)
    .filter(([, t]) => t.combined === isCombined && t.supports.includes(emphasis))
    .map(([id]) => id)
}

// ── Freeform per-slide text blocks ──────────────────────────────────────────
// Drives the per-slide editor + preview. Each slide is a photo + N text
// blocks; each block has a role (drives typography) and a position (preset
// key or { x, y } fraction). Position presets always map to the rendered
// edges with a consistent safe-area PAD so text never collides with chrome.

const FREEFORM_PAD = 64

export const POSITION_PRESETS = [
  'top-left', 'top', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom', 'bottom-right',
]

export const BLOCK_ROLES = ['hook', 'body', 'caption', 'cta', 'attribution', 'page']

import { FONT_SIZE_PX, FONT_WEIGHT_CSS } from './photoTemplates.js'
import { gradeToCanvasFilter } from './gradeParams.js'

const SHADOW_LEVELS = {
  soft:   { color: 'rgba(0,0,0,0.40)', blur: 4,  offsetY: 1 },
  medium: { color: 'rgba(0,0,0,0.65)', blur: 6,  offsetY: 2 },
  strong: { color: 'rgba(0,0,0,0.80)', blur: 14, offsetY: 3 },
}

// Per-role typography defaults (no theme). Sizes tuned for 1080×1080 canvas.
// Per-role defaults, decomposed into parts so per-block style overrides can be
// applied cleanly. Assembling `${italic} ${weight} ${size}px ${family}` from
// these reproduces the original baseFont strings exactly (byte-identical render
// when there are no theme or block overrides).
const ROLE_TYPO = {
  hook:        { weight: 800, size: 84, family: 'heading', lineH: 96, color: 'white',                  uppercase: true,  maxLines: 4, shadow: 'medium', maxWidthFrac: 0.86, italic: false, pill: false },
  body:        { weight: 600, size: 44, family: 'body',    lineH: 56, color: 'white',                  uppercase: false, maxLines: 5, shadow: 'medium', maxWidthFrac: 0.86, italic: false, pill: false },
  caption:     { weight: 500, size: 36, family: 'body',    lineH: 46, color: 'rgba(255,255,255,0.92)', uppercase: false, maxLines: 3, shadow: 'medium', maxWidthFrac: 0.86, italic: true,  pill: false },
  cta:         { weight: 700, size: 42, family: 'heading', lineH: 0,  color: 'white',                  uppercase: false, maxLines: 1, shadow: 'none',   maxWidthFrac: 0.82, italic: false, pill: true  },
  attribution: { weight: 500, size: 30, family: 'body',    lineH: 38, color: 'rgba(255,255,255,0.9)',  uppercase: false, maxLines: 2, shadow: 'soft',   maxWidthFrac: 0.70, italic: false, pill: false },
  page:        { weight: 600, size: 28, family: 'body',    lineH: 34, color: 'rgba(255,255,255,0.85)', uppercase: false, maxLines: 1, shadow: 'soft',   maxWidthFrac: 0.30, italic: false, pill: false },
}
const ROLE_TYPO_DEFAULT = { weight: 500, size: 36, family: 'body', lineH: 46, color: 'white', uppercase: false, maxLines: 3, shadow: 'medium', maxWidthFrac: 0.86, italic: false, pill: false }

// Extract a per-block style override from a slide block (size/color/weight/
// uppercase/font). Null when the block carries no overrides. Precedence in
// roleTypography is block > theme > role default.
function blockStyleOf(block) {
  if (!block) return null
  const s = {}
  if (Number.isFinite(block.fontScale) && block.fontScale > 0 && block.fontScale !== 1) s.fontScale = block.fontScale
  if (typeof block.color === 'string' && block.color) s.color = block.color
  if (block.fontWeight) s.fontWeight = block.fontWeight
  if (typeof block.uppercase === 'boolean') s.uppercase = block.uppercase
  if (block.font === 'heading' || block.font === 'body') s.font = block.font
  return Object.keys(s).length ? s : null
}

function roleTypography(role, brandStyle, themeBlock, blockStyle = null) {
  const { heading, body } = brandFonts(brandStyle)
  const d = ROLE_TYPO[role] || ROLE_TYPO_DEFAULT
  const famOf = (f) => (f === 'heading' ? heading : body)
  const pill = d.pill

  // 1) Role defaults
  let weight = d.weight, size = d.size, family = famOf(d.family)
  let color = d.color, uppercase = d.uppercase, italic = d.italic
  let lineH = d.lineH, shadowLevel = d.shadow, bg = pill ? 'pill' : 'none', bgColor = null

  // 2) Theme overrides (matches the pre-refactor theme branch exactly)
  if (themeBlock) {
    family = famOf(['hook', 'cta'].includes(role) ? 'heading' : 'body')
    size = FONT_SIZE_PX[themeBlock.fontSize] ?? (pill ? 42 : 44)
    weight = FONT_WEIGHT_CSS[themeBlock.fontWeight] ?? '600'
    color = themeBlock.color ?? color
    uppercase = themeBlock.uppercase ?? uppercase
    shadowLevel = themeBlock.shadow ?? 'medium'
    bg = themeBlock.background ?? (pill ? 'pill' : 'none')
    bgColor = themeBlock.bgColor ?? null
    italic = false // the theme path never applied italic
    lineH = Math.round(size * 1.18)
  }

  // 3) Per-block overrides win (the editor's Text-layer styling)
  if (blockStyle) {
    if (blockStyle.font === 'heading') family = heading
    else if (blockStyle.font === 'body') family = body
    if (Number.isFinite(blockStyle.fontScale) && blockStyle.fontScale > 0) {
      size = Math.round(size * blockStyle.fontScale)
      lineH = Math.round(size * 1.18)
    }
    if (blockStyle.fontWeight) weight = blockStyle.fontWeight
    if (blockStyle.color) color = blockStyle.color
    if (typeof blockStyle.uppercase === 'boolean') uppercase = blockStyle.uppercase
  }

  return {
    font: `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`,
    lineH,
    color,
    uppercase,
    maxLines: d.maxLines,
    shadow: shadowLevel !== 'none',
    shadowLevel,
    maxWidthFrac: d.maxWidthFrac,
    pill: bg === 'pill',
    background: bg,
    bgColor,
  }
}

// Resolve a position spec to { anchorX, anchorY, align, vAnchor } in canvas
// pixels. Preset keys snap to a 3×3 grid inset by FREEFORM_PAD. Custom {x,y} is
// the fraction of the canvas (0..1) for the block's anchor point, where the
// anchor sits at the block's text-bottom-left for left/start aligns and
// text-bottom-center for centered aligns.
//
// `vAnchor` ('top' | 'center' | 'bottom') tells drawFreeformBlock how a
// multi-line block grows around anchorY: 'top' grows DOWN (first baseline at
// anchorY) so it never clips off the top safe area, 'center' centers the block
// around anchorY, and 'bottom' grows UP (last baseline at anchorY) so it sits
// in the bottom safe area. Single-line blocks render identically in all three
// modes (the first line IS the last line, at anchorY). Custom {x,y} keeps the
// historical bottom/grow-up anchor — Text Post Studio (src/lib/textCard.js)
// stacks blocks at fixed y-fractions tuned to that behavior, and the editor's
// position picker is WYSIWYG so a top-clip self-corrects on drag.
// W/H default to the square SIZE so existing callers are byte-identical; the
// carousel ad export passes non-square dims. Horizontal anchors use W, vertical
// use H, so preset/custom positions adapt to any aspect.
function resolvePosition(position, W = SIZE, H = SIZE) {
  if (position && typeof position === 'object' && Number.isFinite(position.x) && Number.isFinite(position.y)) {
    const x = Math.max(0, Math.min(1, position.x))
    const y = Math.max(0, Math.min(1, position.y))
    // Custom (dragged on the canvas): the drop point IS the text's CENTRE, so the
    // drag handle — which is centred on (x,y) via -translate-x/y-1/2 — always lines
    // up with the rendered text. Centre both axes for predictable WYSIWYG dragging;
    // the old left/right-by-third + bottom anchor made the text float off the handle
    // and overflow the frame (Q 2026-06-20: "moving text boxes is still funky").
    return { anchorX: Math.round(x * W), anchorY: Math.round(y * H), align: 'center', vAnchor: 'center' }
  }
  const preset = typeof position === 'string' ? position : 'center'
  const [vert, horiz] = preset.includes('-') ? preset.split('-') : [preset, null]
  const colName = horiz || (vert === 'center' ? 'center' : 'center')
  const rowName = (vert === 'top' || vert === 'bottom' || vert === 'center') ? vert : 'center'
  const x = colName === 'left'  ? FREEFORM_PAD
          : colName === 'right' ? W - FREEFORM_PAD
          :                       W / 2
  const y = rowName === 'top'    ? FREEFORM_PAD * 1.5
          : rowName === 'bottom' ? H - FREEFORM_PAD
          :                        H / 2
  const align = colName === 'left' ? 'left' : colName === 'right' ? 'right' : 'center'
  return { anchorX: Math.round(x), anchorY: Math.round(y), align, vAnchor: rowName }
}

function drawTextWithShadow(ctx, text, x, y, level = 'medium') {
  const s = SHADOW_LEVELS[level] || SHADOW_LEVELS.medium
  ctx.save()
  ctx.shadowColor   = s.color
  ctx.shadowBlur    = s.blur
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = s.offsetY
  ctx.fillText(text, x, y)
  ctx.restore()
}

// WHOOP layouts have a dedicated text surface (panel / scrim) — content text
// (hook/body/caption/cta) should sit IN that surface, not float over the photo.
// Returns [topFrac, bottomFrac] of the canvas for the layout's text zone, or
// null to leave positions untouched. Labels (page/attribution) are never
// remapped — they stay in their corners.
const WHOOP_CONTENT_ROLES = new Set(['hook', 'body', 'caption', 'cta'])
function whoopTextZone(layout, palette) {
  if (layout === 'split') return [0.70, 0.95]                  // navy/sage panel (starts 0.67)
  if (layout === 'badge') return palette === 'dark' ? [0.60, 0.93] : [0.61, 0.93]
  if (layout === 'photo') return [0.58, 0.92]                  // full-bleed: anchor text low, on the bottom scrim (U2.1c)
  return null                                                  // claim: full solid ground, leave as-is
}

function drawFreeformBlock(ctx, block, brandStyle, themeBlock, layout = null, palette = null, W = SIZE, H = SIZE) {
  const role = BLOCK_ROLES.includes(block.role) ? block.role : 'body'
  const typo = roleTypography(role, brandStyle, themeBlock, blockStyleOf(block))
  const raw = (block.text || '').trim()
  if (!raw) return
  const display = typo.uppercase ? raw.toUpperCase() : raw
  const isWhoop = !!layout
  let { anchorX, anchorY, align, vAnchor } = resolvePosition(block.position, W, H)

  // Pull content text into the layout's panel/scrim zone (Q sign-off 2026-06-16,
  // option B): a split/badge headline anchored to canvas-center otherwise floats
  // over the photo while the panel sits empty.
  // A user-placed custom {x,y} (dragged on the canvas) is authoritative — skip
  // the panel auto-zone so the text lands exactly where it was dropped. Preset/
  // default positions still get pulled into the layout's panel/scrim zone.
  const hasCustomPos = block.position && typeof block.position === 'object'
    && Number.isFinite(block.position.x) && Number.isFinite(block.position.y)
  const zone = whoopTextZone(layout, palette)
  if (zone && WHOOP_CONTENT_ROLES.has(role) && !hasCustomPos) {
    const [zt, zb] = zone
    // `anchorY` is a BASELINE. A `top` block's glyphs rise ABOVE the baseline by
    // ~one ascent, so anchoring the baseline at the zone top pushes the text up
    // across the seam onto the photo. Offset the baseline down by the ascent so
    // the text's TOP edge sits at the zone top, fully inside the panel.
    const ascent = Math.round((typo.lineH || 60) * 0.8)
    anchorY = vAnchor === 'top'    ? Math.round(H * zt) + ascent
            : vAnchor === 'bottom' ? Math.round(H * zb)
            :                        Math.round(H * (zt + zb) / 2)
  }

  ctx.font = typo.font
  ctx.fillStyle = typo.color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'

  if (typo.pill || typo.background === 'pill') {
    // Pill background — single line, rounded rect behind text
    const bgColor = typo.bgColor || brandAccent(brandStyle)
    const textW = ctx.measureText(display).width
    const pillW = Math.min(textW + 80, Math.round(W * typo.maxWidthFrac))
    const pillH = 80
    let pillX
    if (align === 'left')       pillX = anchorX
    else if (align === 'right') pillX = anchorX - pillW
    else                        pillX = anchorX - pillW / 2
    const pillY = anchorY - pillH
    ctx.fillStyle = bgColor
    drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fill()
    ctx.fillStyle = typo.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(display, pillX + pillW / 2, pillY + pillH / 2)
    return
  }

  // Per-block width override (editor's resize handle): block.width is a fraction
  // of the canvas. Falls back to the role typography's default wrap width. This
  // renderer is shared by preview AND publish (src/lib/renderSlides.js), so the
  // chosen width ships to the baked carousel — no preview≠publish divergence.
  const widthFrac = (Number.isFinite(block.width) && block.width > 0)
    ? Math.max(0.15, Math.min(1, block.width))
    : typo.maxWidthFrac
  const maxW = Math.round(W * widthFrac)
  const lines = wrapLines(ctx, display, maxW, typo.maxLines)
  // Vertical anchoring is zone-aware (see resolvePosition's vAnchor):
  //   top    → first baseline at anchorY, block grows DOWN (never clips the top)
  //   center → block centered around anchorY
  //   bottom → last baseline at anchorY, block grows UP (sits in bottom safe area)
  // `y` is the FIRST line's baseline; the rect-background math below is relative
  // to it, so it wraps the text correctly in every mode.
  const PAD_H = 20  // vertical padding inside rect backgrounds
  const PAD_W = 36  // horizontal padding inside rect backgrounds
  const lastLineOffset = (lines.length - 1) * typo.lineH
  let y = vAnchor === 'top'    ? anchorY
        : vAnchor === 'center' ? anchorY - lastLineOffset / 2
        :                        anchorY - lastLineOffset

  // Skip the per-block text bubble on WHOOP layouts — the panel / scrim / solid
  // ground already provides the contrast, so a `rect` chip is redundant and
  // reads as a floating blob (Q sign-off 2026-06-16, option B). The bubble stays
  // for plain-photo overlays (custom templates / free-positioned editor text),
  // where it's the only contrast. The CTA `pill` button is unaffected (above).
  if (typo.background === 'rect' && !isWhoop) {
    // A `rect` block with no explicit bgColor inherits the brand accent —
    // same `null = brand accent` semantic the pill background already uses.
    const rectColor = typo.bgColor || brandAccent(brandStyle)
    // Width = widest wrapped line + even horizontal padding.
    const maxLineW = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0)
    const rectW = maxLineW + PAD_W * 2
    let rectX
    if (align === 'left')       rectX = anchorX - PAD_W
    else if (align === 'right') rectX = anchorX - maxLineW - PAD_W
    else                        rectX = anchorX - maxLineW / 2 - PAD_W
    // Height bounds ALL wrapped lines via real glyph metrics: from the first
    // line's top (baseline − ascent) to the last line's bottom (last baseline +
    // descent), with even PAD_H on both ends. Fixes the old box that hugged only
    // the first line and let wrapped lines spill outside it.
    const gm = ctx.measureText(lines[0] || 'Mg')
    const ascent  = gm.actualBoundingBoxAscent  || typo.lineH * 0.74
    const descent = gm.actualBoundingBoxDescent || typo.lineH * 0.24
    const rectY = y - ascent - PAD_H
    const rectH = ascent + (lines.length - 1) * typo.lineH + descent + PAD_H * 2
    const radius = Math.min(36, rectH / 2)
    ctx.fillStyle = rectColor
    drawRoundedRect(ctx, rectX, rectY, rectW, rectH, radius)
    ctx.fill()
  }

  ctx.fillStyle = typo.color
  for (const l of lines) {
    if (typo.shadow) drawTextWithShadow(ctx, l, anchorX, y, typo.shadowLevel)
    else             ctx.fillText(l, anchorX, y)
    y += typo.lineH
  }
  ctx.textAlign = 'start'
}

// Per-slide template chip → default block set for AI generation. The renderer
// doesn't consume this; it's metadata for prompt + UI defaults. Editor users
// can switch templates to swap the AI's default block pattern.
export const SLIDE_TEMPLATES = {
  cover:         { label: 'Cover',         default_blocks: ['hook', 'page'] },
  explainer:     { label: 'Explainer',     default_blocks: ['hook', 'body', 'caption'] },
  demonstration: { label: 'Demonstration', default_blocks: [] },
  quote:         { label: 'Quote',         default_blocks: ['body', 'attribution'] },
  cta:           { label: 'CTA',           default_blocks: ['hook', 'body', 'cta'] },
  custom:        { label: 'Custom',        default_blocks: [] },
}

export const TEMPLATE_DEFAULT_POSITIONS = {
  cover:         { hook: 'center',      page: 'bottom-right' },
  explainer:     { hook: 'top',         body: 'center',       caption: 'bottom' },
  demonstration: {},
  quote:         { body: 'center',      attribution: 'bottom-right' },
  cta:           { hook: 'top',         body: 'center',       cta: 'bottom' },
  custom:        {},
}

// ── WHOOP layout geometry ───────────────────────────────────────────────────
//
// Implements the six built-in layout families directly in canvas so preview
// matches the Sharp server compositor (Option B fidelity fix). Each layout
// paints its own background + structural elements (panels, rules, scrims).
// The text blocks are still drawn by drawFreeformBlock after this returns.
//
// Layouts:
//   claim  — full-bleed solid ground (navy dark, paper light); no photo;
//             4px orange rule at ~11% from top
//   split  — photo top ~67%, solid panel bottom third (navy dark, sage light);
//             4px orange rule at the seam
//   badge  — dark: full-bleed photo + dark overlay + gradient scrim + rule @58%;
//             light: photo top ~58%, white panel below + rule at seam
//   photo  — clean full-bleed photo + edge scrims only (no dim, no rule); the
//             default. Text overlaid; zoom/reposition frames the photo.

const WHOOP_NAVY      = '#0c1a2e'
const WHOOP_PAPER     = '#f6f4ef'
const WHOOP_SAGE_FILL = '#eaeeea'

// Draw the source photo with the per-slide colorist grade applied (and only the
// photo — panels/scrims/rules stay ungraded). `photoFilter` is a CSS filter
// string from gradeToCanvasFilter, 'none' when neutral.
function drawGradedCover(ctx, img, x, y, w, h, zoom, offset, photoFilter) {
  const prev = ctx.filter
  if (photoFilter && photoFilter !== 'none') ctx.filter = photoFilter
  drawPhotoFit(ctx, img, x, y, w, h, zoom, offset)
  ctx.filter = prev || 'none'
}

// ── Structure-primitive renderer ────────────────────────────────────────────
//
// Interprets the `structure` array on a theme config (see photoTemplates.js for
// the full vocabulary). Each primitive is drawn in order onto `ctx`.
// Color specs may be semantic tokens ('$ink', '$paper', '$accent') or objects
// { token, fallback?, lighten? } — resolved to CSS colors at draw time.

function resolveColor(spec, brandStyle) {
  if (!spec) return '#000000'
  if (typeof spec === 'string') {
    if (spec === '$ink')    return brandInk(brandStyle, WHOOP_NAVY)
    if (spec === '$paper')  return brandPaper(brandStyle, WHOOP_PAPER)
    if (spec === '$accent') return brandAccent(brandStyle)
    return spec
  }
  if (typeof spec === 'object') {
    const fb = spec.fallback
    let base
    if (spec.token === '$ink')    base = brandInk(brandStyle,   fb || WHOOP_NAVY)
    else if (spec.token === '$paper')  base = brandPaper(brandStyle, fb || WHOOP_PAPER)
    else if (spec.token === '$accent') base = brandAccent(brandStyle)
    else base = spec.color || '#000000'
    if (spec.lighten != null) return shadeHex(base, spec.lighten)
    return base
  }
  return '#000000'
}

function drawStructure(ctx, structure, brandStyle, img, W, H, photoZoom, photoOffset, photoFilter) {
  for (const p of structure) {
    switch (p.type) {

      case 'bg-solid': {
        ctx.fillStyle = resolveColor(p.color, brandStyle)
        ctx.fillRect(0, 0, W, H)
        break
      }

      case 'bg-radial': {
        // Full form uses x0Frac/y0Frac/r0/x1Frac/y1Frac/r1Frac (built-in themes).
        // Simplified model form uses yCenterFrac only — sensible defaults for the rest.
        let x0, y0, r0, x1, y1, r1
        if (p.x0Frac != null) {
          x0 = W * p.x0Frac; y0 = H * p.y0Frac; r0 = p.r0 ?? 0
          x1 = W * p.x1Frac; y1 = H * p.y1Frac; r1 = W * (p.r1Frac ?? 0.72)
        } else {
          const yc = p.yCenterFrac ?? 0.45
          x0 = W * 0.5; y0 = H * yc; r0 = 0
          x1 = W * 0.5; y1 = H * yc; r1 = W * 0.72
        }
        const grad = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1)
        grad.addColorStop(0, resolveColor(p.colorCenter, brandStyle))
        grad.addColorStop(1, resolveColor(p.colorEdge,   brandStyle))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, W, H)
        break
      }

      case 'bg-linear': {
        const grad = ctx.createLinearGradient(0, 0, 0, H)
        grad.addColorStop(0, resolveColor(p.colorFrom, brandStyle))
        grad.addColorStop(1, resolveColor(p.colorTo,   brandStyle))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, W, H)
        break
      }

      case 'photo': {
        if (img) {
          drawGradedCover(ctx, img, 0, 0, W, H, photoZoom, photoOffset, photoFilter)
        } else if (p.fallback) {
          drawStructure(ctx, [p.fallback], brandStyle, null, W, H, 1, null, 'none')
        }
        break
      }

      case 'overlay': {
        ctx.fillStyle = resolveColor(p.color, brandStyle)
        ctx.fillRect(0, 0, W, H)
        break
      }

      case 'scrim': {
        const sy1 = Math.round(H * p.yFrac)
        const sy2 = Math.round(H * (p.yEndFrac ?? 1.0))
        const grad = ctx.createLinearGradient(0, sy1, 0, sy2)
        if (p.stops?.length) {
          // Full form (built-in themes): explicit stop array
          for (const [pos, color] of p.stops) grad.addColorStop(pos, color)
        } else {
          // Simplified model form: single opacity → black-transparent gradient
          const op = Math.min(1, Math.max(0, p.opacity ?? 0.7))
          grad.addColorStop(0,    'rgba(0,0,0,0)')
          grad.addColorStop(0.55, `rgba(0,0,0,${(op * 0.6).toFixed(2)})`)
          grad.addColorStop(1.0,  `rgba(0,0,0,${op.toFixed(2)})`)
        }
        ctx.fillStyle = grad
        ctx.fillRect(0, sy1, W, sy2 - sy1)
        break
      }

      case 'panel': {
        const panY = Math.round(H * p.yFrac)
        ctx.fillStyle = resolveColor(p.color, brandStyle)
        ctx.fillRect(0, panY, W, H - panY)
        break
      }

      case 'rule': {
        const rY    = Math.round(H * p.yFrac)
        const thick = p.thickness ?? 4
        ctx.fillStyle = resolveColor(p.color, brandStyle)
        if (p.padded) {
          const pad = Math.round(W * (FREEFORM_PAD / SIZE))
          ctx.fillRect(pad, rY, W - pad * 2, thick)
        } else {
          ctx.fillRect(0, rY, W, thick)
        }
        break
      }

      case 'gradient-panel': {
        const panY = Math.round(H * p.yFrac)
        const grad = ctx.createLinearGradient(0, panY, 0, H)
        grad.addColorStop(0, resolveColor(p.colorFrom, brandStyle))
        grad.addColorStop(1, resolveColor(p.colorTo,   brandStyle))
        ctx.fillStyle = grad
        ctx.fillRect(0, panY, W, H - panY)
        break
      }

      case 'circle': {
        const cx = W * (p.cxFrac ?? 0.5)
        const cy = H * (p.cyFrac ?? 0.5)
        const r  = W * (p.rFrac  ?? 0.1)
        ctx.fillStyle = resolveColor(p.color, brandStyle)
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        break
      }

      default: break
    }
  }
}

function drawWhoopLayout(ctx, { layout, palette, img, brandStyle, zoom = 1, offset = null, photoFilter = 'none', W = SIZE, H = SIZE }) {
  const accent = brandAccent(brandStyle)

  if (layout === 'claim') {
    if (palette === 'dark') {
      const ink = brandInk(brandStyle, WHOOP_NAVY)
      const grad = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.72)
      grad.addColorStop(0, shadeHex(ink, 0.13))
      grad.addColorStop(1, ink)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = brandPaper(brandStyle, WHOOP_PAPER)
    }
    ctx.fillRect(0, 0, W, H)
    // Orange rule near the top
    const ruleY = Math.round(H * 0.11)
    ctx.fillStyle = accent
    ctx.fillRect(FREEFORM_PAD, ruleY, W - FREEFORM_PAD * 2, 4)

  } else if (layout === 'split') {
    const splitY = Math.round(H * 0.67)
    // Photo is the FULL-BLEED base layer (fills the whole frame, framed by the
    // user's zoom/offset). The brand panel is an OVERLAY over the bottom third —
    // it does NOT crop the photo into a box. The photo never shrinks; you frame
    // the full image. (Structure fix, Q 2026-06-20; panel/rule styling unchanged.)
    if (img) {
      drawGradedCover(ctx, img, 0, 0, W, H, zoom, offset, photoFilter)
    } else {
      const base = brandInk(brandStyle, '#1e293b')
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, shadeHex(base, 0.28))
      grad.addColorStop(1, base)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }
    // Solid brand panel overlays the bottom third (full-bleed photo behind it)
    ctx.fillStyle = palette === 'dark' ? brandInk(brandStyle, WHOOP_NAVY) : brandPaper(brandStyle, WHOOP_SAGE_FILL)
    ctx.fillRect(0, splitY, W, H - splitY)
    // Orange rule at the photo/panel seam
    ctx.fillStyle = accent
    ctx.fillRect(0, splitY, W, 4)

  } else if (layout === 'photo') {
    // Clean full-bleed photo — "the photo is the photo". No global dim, no rule;
    // just edge scrims (stronger bottom for the hook, light top for labels/page)
    // so overlaid text stays legible. (U2.1b, Q sign-off 2026-06-20.)
    if (img) {
      drawGradedCover(ctx, img, 0, 0, W, H, zoom, offset, photoFilter)
    } else {
      const base = brandInk(brandStyle, '#1e293b')
      const grad = ctx.createLinearGradient(0, 0, 0, H)
      grad.addColorStop(0, shadeHex(base, 0.28))
      grad.addColorStop(1, base)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, W, H)
    }
    // Bottom scrim — the primary text zone (hook / body / cta land here)
    const botStart = Math.round(H * 0.50)
    const bot = ctx.createLinearGradient(0, botStart, 0, H)
    bot.addColorStop(0, 'rgba(0,0,0,0)')
    bot.addColorStop(0.55, 'rgba(0,0,0,0.42)')
    bot.addColorStop(1, 'rgba(0,0,0,0.74)')
    ctx.fillStyle = bot
    ctx.fillRect(0, botStart, W, H - botStart)
    // Light top scrim — labels / page number stay legible on bright photos
    const topH = Math.round(H * 0.22)
    const top = ctx.createLinearGradient(0, 0, 0, topH)
    top.addColorStop(0, 'rgba(0,0,0,0.34)')
    top.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = top
    ctx.fillRect(0, 0, W, topH)

  } else {
    // badge
    if (palette === 'dark') {
      if (img) {
        drawGradedCover(ctx, img, 0, 0, W, H, zoom, offset, photoFilter)
      } else {
        ctx.fillStyle = brandInk(brandStyle, WHOOP_NAVY)
        ctx.fillRect(0, 0, W, H)
      }
      // Dark overlay to anchor the gradient (neutral black, not a navy tint)
      ctx.fillStyle = 'rgba(0,0,0,0.30)'
      ctx.fillRect(0, 0, W, H)
      // Gradient scrim anchoring text at the bottom
      const scrimStart = Math.round(H * 0.48)
      const scrim = ctx.createLinearGradient(0, scrimStart, 0, H)
      scrim.addColorStop(0, 'rgba(0,0,0,0)')
      scrim.addColorStop(0.45, 'rgba(0,0,0,0.80)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.97)')
      ctx.fillStyle = scrim
      ctx.fillRect(0, scrimStart, W, H - scrimStart)
      // Orange rule above the text zone
      const ruleY = Math.round(H * 0.57)
      ctx.fillStyle = accent
      ctx.fillRect(FREEFORM_PAD, ruleY, W - FREEFORM_PAD * 2, 4)

    } else {
      // light-badge: full-bleed photo that fades softly into a white panel
      // below — mirrors the dark-badge scrim treatment (fade, not a hard seam).
      const panelY = Math.round(H * 0.58)
      if (img) {
        drawGradedCover(ctx, img, 0, 0, W, H, zoom, offset, photoFilter)
      } else {
        const base = brandPaper(brandStyle, '#cbd5e1')
        const grad = ctx.createLinearGradient(0, 0, 0, H)
        grad.addColorStop(0, shadeHex(base, 0.06))
        grad.addColorStop(1, shadeHex(base, -0.08))
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, W, H)
      }
      // White scrim fading the photo into a TRANSLUCENT panel (not solid), so
      // the photo keeps ghosting through below the seam — mirrors the dark-badge
      // see-through treatment (Q sign-off 2026-06-16, option 1B).
      const PANEL_ALPHA = 0.72
      const scrimStart = Math.round(H * 0.40)
      const scrim = ctx.createLinearGradient(0, scrimStart, 0, panelY)
      scrim.addColorStop(0, 'rgba(255,255,255,0)')
      scrim.addColorStop(0.7, `rgba(255,255,255,${PANEL_ALPHA * 0.85})`)
      scrim.addColorStop(1, `rgba(255,255,255,${PANEL_ALPHA})`)
      ctx.fillStyle = scrim
      ctx.fillRect(0, scrimStart, W, panelY - scrimStart)
      // Translucent white panel below the fade — photo shows through faintly
      ctx.fillStyle = `rgba(255,255,255,${PANEL_ALPHA})`
      ctx.fillRect(0, panelY, W, H - panelY)
      // Orange rule at the panel top
      ctx.fillStyle = accent
      ctx.fillRect(0, panelY, W, 4)
    }
  }
}

// Render one slide (photo + freeform text blocks) to a canvas. Returns the
// canvas so callers can either display it directly (DOM canvas preview) or
// call toBlob() to produce a baked PNG.
export async function renderFreeformSlide({ sourceUrl, slide, brandStyle, canvas, theme, background, width = SIZE, height = SIZE }) {
  const target = canvas || document.createElement('canvas')
  const W = width, H = height
  const square = W === H
  target.width  = W
  target.height = H
  const ctx = target.getContext('2d')

  const layout = theme?.layout
  const palette = theme?.palette
  // WHOOP built-in panel geometry is now ASPECT-AWARE (drawWhoopLayout takes
  // W,H), so the same template renders at any container aspect — 1:1, 4:5, 9:16.
  const useWhoop = layout && palette

  // Per-slide photo reframe — drag-pan + zoom of the source photo, applied in
  // the single shared renderer so preview, publish bake, and ad export all match.
  const photoZoom = slide?.photo_zoom || 1
  const photoOffset = slide?.photo_offset || null
  // Per-slide colorist grade — applied ONLY to the photo pixels (not panels/text)
  // in the single shared renderer, so editor preview, publish bake, and ad export
  // all carry the same look.
  const photoFilter = gradeToCanvasFilter(slide?.grade)

  if (useWhoop) {
    // Paint structural geometry: data-driven path when the theme declares a
    // `structure` array; legacy drawWhoopLayout for older custom themes that
    // have layout/palette but no structure field.
    const img = sourceUrl ? await loadImage(sourceUrl) : null
    if (Array.isArray(theme?.structure)) {
      drawStructure(ctx, theme.structure, brandStyle || {}, img, W, H, photoZoom, photoOffset, photoFilter)
    } else {
      drawWhoopLayout(ctx, { layout, palette, img, brandStyle: brandStyle || {}, zoom: photoZoom, offset: photoOffset, photoFilter, W, H })
    }
  } else if (sourceUrl) {
    const img = await loadImage(sourceUrl)
    const prevFilter = ctx.filter
    if (photoFilter !== 'none') ctx.filter = photoFilter
    drawPhotoFit(ctx, img, 0, 0, W, H, photoZoom, photoOffset)
    ctx.filter = prevFilter || 'none'
  } else if (background) {
    // Text-only card (Text Post Studio): paint a brand-aware background.
    paintCardBackground(ctx, background, brandStyle)
  } else {
    // No photo bound — render a neutral placeholder so text is still legible
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#475569')
    grad.addColorStop(1, '#1e293b')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
  }

  // Scrim so any-position text stays legible over a plain photo. WHOOP layouts
  // have their own panel/scrim geometry so skip the generic one. Square keeps
  // the historical radial vignette (byte-identical to existing 1:1 renders);
  // non-square (carousel ad aspects) uses a linear top+bottom scrim — the radial
  // is concentric-on-center and loses contrast at the top/bottom text zones on
  // tall/wide canvases (Q sign-off 2026-06-19).
  // Ad-mode templates render the structural background only — no text blocks —
  // so the canvas is a clean background for ad copy set elsewhere.
  const blocks = theme?.mode === 'ad' ? [] : (Array.isArray(slide?.blocks) ? slide.blocks : [])
  if (!useWhoop && sourceUrl && blocks.length > 0) {
    let scrim
    if (square) {
      scrim = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.75)
      scrim.addColorStop(0, 'rgba(0,0,0,0)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.45)')
    } else {
      scrim = ctx.createLinearGradient(0, 0, 0, H)
      scrim.addColorStop(0, 'rgba(0,0,0,0.55)')
      scrim.addColorStop(0.28, 'rgba(0,0,0,0.05)')
      scrim.addColorStop(0.72, 'rgba(0,0,0,0.05)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.62)')
    }
    ctx.fillStyle = scrim
    ctx.fillRect(0, 0, W, H)
  }

  // Blocks render at their (fractional) positions; drawWhoopLayout is aspect-aware
  // so the panels line up with the text zones at any aspect.
  for (const block of blocks) {
    const themeBlock = theme?.blocks?.[block.role] ?? null
    drawFreeformBlock(ctx, block, brandStyle || {}, themeBlock, useWhoop ? layout : null, useWhoop ? palette : null, W, H)
  }

  return target
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

// Render one slide and return a PNG blob. Used by ReviewPost compose flows.
//   spec = { template, emphasis?, colorChoice?, photoDim?, text }
//   text  = string (solo) or { hook, subhead, cta } (combined)
export async function renderSlide({ sourceUrl, spec, brandStyle }) {
  const tmpl = TEMPLATES[spec.template]
  if (!tmpl) throw new Error(`Unknown template: ${spec.template}`)

  const canvas = document.createElement('canvas')
  canvas.width  = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')

  const img = await loadImage(sourceUrl)
  tmpl.render(ctx, {
    img,
    text: spec.text,
    brandStyle: brandStyle || {},
    options: {
      emphasis:    spec.emphasis,
      colorChoice: spec.colorChoice,
      photoDim:    spec.photoDim,
    },
  })

  return await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), 'image/png', 0.92)
  )
}
