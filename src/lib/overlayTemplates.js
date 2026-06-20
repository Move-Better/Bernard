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

const SHADOW_LEVELS = {
  soft:   { color: 'rgba(0,0,0,0.40)', blur: 4,  offsetY: 1 },
  medium: { color: 'rgba(0,0,0,0.65)', blur: 6,  offsetY: 2 },
  strong: { color: 'rgba(0,0,0,0.80)', blur: 14, offsetY: 3 },
}

// Per-role typography defaults (no theme). Sizes tuned for 1080×1080 canvas.
function roleTypography(role, brandStyle, themeBlock) {
  const { heading, body } = brandFonts(brandStyle)

  // Base defaults by role
  let baseFont, lineH, color, uppercase, maxLines, shadowLevel, maxWidthFrac, pill
  switch (role) {
    case 'hook':
      baseFont = `800 84px ${heading}`; lineH = 96; color = 'white'; uppercase = true;
      maxLines = 4; shadowLevel = 'medium'; maxWidthFrac = 0.86; break
    case 'body':
      baseFont = `600 44px ${body}`; lineH = 56; color = 'white'; uppercase = false;
      maxLines = 5; shadowLevel = 'medium'; maxWidthFrac = 0.86; break
    case 'caption':
      baseFont = `italic 500 36px ${body}`; lineH = 46; color = 'rgba(255,255,255,0.92)'; uppercase = false;
      maxLines = 3; shadowLevel = 'medium'; maxWidthFrac = 0.86; break
    case 'cta':
      baseFont = `700 42px ${heading}`; lineH = 0; color = 'white'; uppercase = false;
      maxLines = 1; shadowLevel = 'none'; maxWidthFrac = 0.82; pill = true; break
    case 'attribution':
      baseFont = `500 30px ${body}`; lineH = 38; color = 'rgba(255,255,255,0.9)'; uppercase = false;
      maxLines = 2; shadowLevel = 'soft'; maxWidthFrac = 0.70; break
    case 'page':
      baseFont = `600 28px ${body}`; lineH = 34; color = 'rgba(255,255,255,0.85)'; uppercase = false;
      maxLines = 1; shadowLevel = 'soft'; maxWidthFrac = 0.30; break
    default:
      baseFont = `500 36px ${body}`; lineH = 46; color = 'white'; uppercase = false;
      maxLines = 3; shadowLevel = 'medium'; maxWidthFrac = 0.86
  }

  if (!themeBlock) {
    return { font: baseFont, lineH, color, uppercase, maxLines,
             shadow: shadowLevel !== 'none', shadowLevel, maxWidthFrac,
             pill: !!pill, background: pill ? 'pill' : 'none', bgColor: null }
  }

  // Apply theme overrides
  const family = ['hook', 'cta'].includes(role) ? heading : body
  const sz  = FONT_SIZE_PX[themeBlock.fontSize] ?? (pill ? 42 : 44)
  const wt  = FONT_WEIGHT_CSS[themeBlock.fontWeight] ?? '600'
  const font = `${wt} ${sz}px ${family}`
  const tShadow = themeBlock.shadow ?? 'medium'
  const bg      = themeBlock.background ?? (pill ? 'pill' : 'none')

  return {
    font,
    lineH: Math.round(sz * 1.18),
    color:        themeBlock.color ?? color,
    uppercase:    themeBlock.uppercase ?? uppercase,
    maxLines,
    shadow:       tShadow !== 'none',
    shadowLevel:  tShadow,
    maxWidthFrac,
    pill:         bg === 'pill',
    background:   bg,
    bgColor:      themeBlock.bgColor ?? null,
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
    // Custom: align by which third of the canvas the anchor sits in
    const align = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center'
    return { anchorX: Math.round(x * W), anchorY: Math.round(y * H), align, vAnchor: 'bottom' }
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
  return null                                                  // claim: full solid ground, leave as-is
}

function drawFreeformBlock(ctx, block, brandStyle, themeBlock, layout = null, palette = null, W = SIZE, H = SIZE) {
  const role = BLOCK_ROLES.includes(block.role) ? block.role : 'body'
  const typo = roleTypography(role, brandStyle, themeBlock)
  const raw = (block.text || '').trim()
  if (!raw) return
  const display = typo.uppercase ? raw.toUpperCase() : raw
  const isWhoop = !!layout
  let { anchorX, anchorY, align, vAnchor } = resolvePosition(block.position, W, H)

  // Pull content text into the layout's panel/scrim zone (Q sign-off 2026-06-16,
  // option B): a split/badge headline anchored to canvas-center otherwise floats
  // over the photo while the panel sits empty.
  const zone = whoopTextZone(layout, palette)
  if (zone && WHOOP_CONTENT_ROLES.has(role)) {
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

const WHOOP_NAVY      = '#0c1a2e'
const WHOOP_PAPER     = '#f6f4ef'
const WHOOP_SAGE_FILL = '#eaeeea'

function drawWhoopLayout(ctx, { layout, palette, img, brandStyle, zoom = 1, offset = null }) {
  const accent = brandAccent(brandStyle)

  if (layout === 'claim') {
    if (palette === 'dark') {
      const grad = ctx.createRadialGradient(SIZE * 0.5, SIZE * 0.42, 0, SIZE * 0.5, SIZE * 0.5, SIZE * 0.72)
      grad.addColorStop(0, '#1b2f4a')
      grad.addColorStop(1, WHOOP_NAVY)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = WHOOP_PAPER
    }
    ctx.fillRect(0, 0, SIZE, SIZE)
    // Orange rule near the top
    const ruleY = Math.round(SIZE * 0.11)
    ctx.fillStyle = accent
    ctx.fillRect(FREEFORM_PAD, ruleY, SIZE - FREEFORM_PAD * 2, 4)

  } else if (layout === 'split') {
    const splitY = Math.round(SIZE * 0.67)
    if (img) {
      drawCover(ctx, img, 0, 0, SIZE, splitY, zoom, offset)
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, splitY)
      grad.addColorStop(0, '#475569')
      grad.addColorStop(1, '#1e293b')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, SIZE, splitY)
    }
    ctx.fillStyle = palette === 'dark' ? WHOOP_NAVY : WHOOP_SAGE_FILL
    ctx.fillRect(0, splitY, SIZE, SIZE - splitY)
    // Orange rule at the photo/panel seam
    ctx.fillStyle = accent
    ctx.fillRect(0, splitY, SIZE, 4)

  } else {
    // badge
    if (palette === 'dark') {
      if (img) {
        drawCover(ctx, img, 0, 0, SIZE, SIZE, zoom, offset)
      } else {
        ctx.fillStyle = WHOOP_NAVY
        ctx.fillRect(0, 0, SIZE, SIZE)
      }
      // Dark overlay to anchor the gradient
      ctx.fillStyle = 'rgba(12,26,46,0.30)'
      ctx.fillRect(0, 0, SIZE, SIZE)
      // Gradient scrim anchoring text at the bottom
      const scrimStart = Math.round(SIZE * 0.48)
      const scrim = ctx.createLinearGradient(0, scrimStart, 0, SIZE)
      scrim.addColorStop(0, 'rgba(12,26,46,0)')
      scrim.addColorStop(0.45, 'rgba(12,26,46,0.80)')
      scrim.addColorStop(1, 'rgba(12,26,46,0.97)')
      ctx.fillStyle = scrim
      ctx.fillRect(0, scrimStart, SIZE, SIZE - scrimStart)
      // Orange rule above the text zone
      const ruleY = Math.round(SIZE * 0.57)
      ctx.fillStyle = accent
      ctx.fillRect(FREEFORM_PAD, ruleY, SIZE - FREEFORM_PAD * 2, 4)

    } else {
      // light-badge: full-bleed photo that fades softly into a white panel
      // below — mirrors the dark-badge scrim treatment (fade, not a hard seam).
      const panelY = Math.round(SIZE * 0.58)
      if (img) {
        drawCover(ctx, img, 0, 0, SIZE, SIZE, zoom, offset)
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, SIZE)
        grad.addColorStop(0, '#e2e8f0')
        grad.addColorStop(1, '#cbd5e1')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, SIZE, SIZE)
      }
      // White scrim fading the photo into a TRANSLUCENT panel (not solid), so
      // the photo keeps ghosting through below the seam — mirrors the dark-badge
      // see-through treatment (Q sign-off 2026-06-16, option 1B).
      const PANEL_ALPHA = 0.72
      const scrimStart = Math.round(SIZE * 0.40)
      const scrim = ctx.createLinearGradient(0, scrimStart, 0, panelY)
      scrim.addColorStop(0, 'rgba(255,255,255,0)')
      scrim.addColorStop(0.7, `rgba(255,255,255,${PANEL_ALPHA * 0.85})`)
      scrim.addColorStop(1, `rgba(255,255,255,${PANEL_ALPHA})`)
      ctx.fillStyle = scrim
      ctx.fillRect(0, scrimStart, SIZE, panelY - scrimStart)
      // Translucent white panel below the fade — photo shows through faintly
      ctx.fillStyle = `rgba(255,255,255,${PANEL_ALPHA})`
      ctx.fillRect(0, panelY, SIZE, SIZE - panelY)
      // Orange rule at the panel top
      ctx.fillStyle = accent
      ctx.fillRect(0, panelY, SIZE, 4)
    }
  }
}

// Panel-template (WHOOP) slides anchor their content to a square bottom panel.
// When such a slide is exported to a non-square ad aspect we can't use the panel
// geometry, so re-stack the content blocks (hook → body → caption → CTA) bottom-
// up in the lower zone, measured so nothing overlaps. Labels keep their corners.
// (Q sign-off 2026-06-19, .claude/mockups/carousel-whoop-stack.html.)
const STACK_ROLE_ORDER = { hook: 0, body: 1, caption: 2, cta: 3 }
function stackContentBottom(ctx, blocks, brandStyle, theme, W, H) {
  const content = blocks
    .filter((b) => b && b.role in STACK_ROLE_ORDER && (b.text || '').trim() !== '')
    .sort((a, b) => STACK_ROLE_ORDER[a.role] - STACK_ROLE_ORDER[b.role])
  const labels = blocks.filter((b) => b && !(b.role in STACK_ROLE_ORDER))
  if (content.length === 0) return blocks

  const gap = Math.round(H * 0.018)
  const measured = content.map((b) => {
    const typo = roleTypography(b.role, brandStyle, theme?.blocks?.[b.role] ?? null)
    if (typo.pill || typo.background === 'pill') return { b, h: 80 }
    ctx.font = typo.font
    const display = typo.uppercase ? (b.text || '').toUpperCase() : (b.text || '')
    const widthFrac = (Number.isFinite(b.width) && b.width > 0)
      ? Math.max(0.15, Math.min(1, b.width))
      : typo.maxWidthFrac
    const lines = wrapLines(ctx, display, Math.round(W * widthFrac), typo.maxLines)
    const ascent = Math.round((typo.lineH || 60) * 0.8)
    return { b, h: (lines.length - 1) * typo.lineH + ascent }
  })

  // Place bottom-up: cursor is the bottom-most block's last baseline / pill bottom.
  let cursor = H - FREEFORM_PAD
  const placed = []
  for (let i = measured.length - 1; i >= 0; i--) {
    const m = measured[i]
    placed.unshift({ ...m.b, position: { x: 0.5, y: cursor / H } })
    cursor = cursor - m.h - gap
  }
  return [...placed, ...labels]
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
  // WHOOP built-in panel geometry is square-designed; only use it on a square
  // canvas. The carousel ad export (non-square) renders photo + blocks instead,
  // so every card shares the chosen aspect.
  const useWhoop = layout && palette && square
  // A panel-template slide exported non-square: bottom-stack the content (below).
  const whoopNonSquare = !!(layout && palette) && !square

  // Per-slide photo reframe — drag-pan + zoom of the source photo, applied in
  // the single shared renderer so preview, publish bake, and ad export all match.
  const photoZoom = slide?.photo_zoom || 1
  const photoOffset = slide?.photo_offset || null

  if (useWhoop) {
    // WHOOP built-in — paint structural geometry (background, panel, rule)
    const img = sourceUrl ? await loadImage(sourceUrl) : null
    drawWhoopLayout(ctx, { layout, palette, img, brandStyle: brandStyle || {}, zoom: photoZoom, offset: photoOffset })
  } else if (sourceUrl) {
    const img = await loadImage(sourceUrl)
    drawCover(ctx, img, 0, 0, W, H, photoZoom, photoOffset)
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
  const blocks = Array.isArray(slide?.blocks) ? slide.blocks : []
  if (!useWhoop && sourceUrl && blocks.length > 0) {
    let scrim
    if (square) {
      scrim = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.75)
      scrim.addColorStop(0, 'rgba(0,0,0,0)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.45)')
    } else if (whoopNonSquare) {
      // Stronger bottom panel-ish scrim behind the bottom-stacked content.
      scrim = ctx.createLinearGradient(0, 0, 0, H)
      scrim.addColorStop(0, 'rgba(0,0,0,0.35)')
      scrim.addColorStop(0.45, 'rgba(0,0,0,0.05)')
      scrim.addColorStop(0.6, 'rgba(0,0,0,0.45)')
      scrim.addColorStop(1, 'rgba(0,0,0,0.85)')
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

  // Panel-template slides → non-square: re-stack content blocks bottom-up so the
  // panel-anchored text doesn't collide. Square/freeform render unchanged.
  const renderBlocks = whoopNonSquare ? stackContentBottom(ctx, blocks, brandStyle || {}, theme, W, H) : blocks
  for (const block of renderBlocks) {
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
