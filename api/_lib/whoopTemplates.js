// WHOOP-direction photo templates (Photo Compositor P2).
//
// Six named templates across three layout families × light/dark palettes:
//   dark-claim   / light-claim   — full-bleed claim card, no photo needed
//   dark-badge   / light-badge   — photo + WHOOP-style ring badge + headline
//   dark-split   / light-split    — photo top, solid color panel below
//
// Shared brand DNA (the "glue" that makes the feed read as one brand):
//   • Titillium Web (brand heading font), embedded in the SVG as a data-URI
//   • navy ink / deep-navy ground (#0c1a2e)
//   • ONE orange accent (workspace primary) on a single word/rule/ring
//   • sage (workspace accent) for small uppercase tracked labels
//   • a claim or metric as the hero — never a paragraph
//
// All templates render to a JPEG buffer the compose-photo endpoint uploads.
// Reuses the Sharp + SVG + embedded-font pipeline from brandRender.js.

import sharp from 'sharp'
import { getBrandFont, ensureFontconfig } from './brandFonts.js'
import { resolveBrandColors } from './brandRender.js'

const NAVY = '#0c1a2e'
const NAVY_RADIAL = '#14294a'
const PAPER = '#f6f4ef'
const SAGE_PANEL = '#eaeeea'

export const WHOOP_ASPECTS = {
  '4:5':  [1080, 1350],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '16:9': [1920, 1080], // YouTube in-stream / Google Display — added for ad export
}

export const WHOOP_TEMPLATE_IDS = [
  'dark-claim', 'light-claim',
  'dark-badge', 'light-badge',
  'dark-split', 'light-split',
]

function svgEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// Greedy word-wrap that also tags which trailing words belong to the accent
// phrase (the accent is always a suffix of the headline). Returns an array of
// lines; each line is an array of { w, accent } tokens.
function layoutHeadline(headline, accentText, maxChars, maxLines) {
  const words = String(headline || '').trim().split(/\s+/).filter(Boolean)
  let accentStart = words.length
  if (accentText) {
    const norm = (s) => s.toLowerCase().replace(/[^\w]/g, '')
    const aWords = String(accentText).trim().split(/\s+/).filter(Boolean)
    if (aWords.length && aWords.length <= words.length) {
      let ok = true
      for (let i = 0; i < aWords.length; i++) {
        if (norm(words[words.length - aWords.length + i]) !== norm(aWords[i])) { ok = false; break }
      }
      if (ok) accentStart = words.length - aWords.length
    }
  }
  const lines = []
  let cur = []
  let curLen = 0
  words.forEach((w, i) => {
    const add = (cur.length ? 1 : 0) + w.length
    if (curLen + add > maxChars && cur.length) { lines.push(cur); cur = []; curLen = 0 }
    cur.push({ w, accent: i >= accentStart })
    curLen += (cur.length > 1 ? 1 : 0) + w.length
  })
  if (cur.length) lines.push(cur)
  return lines.slice(0, maxLines)
}

// Render one wrapped line as a single <text> with inline <tspan> color runs.
// Inline tspans (no x/y) flow naturally — the renderer measures glyph widths,
// so multi-color words align perfectly without us knowing font metrics.
function lineSvg(lineWords, x, y, fontSize, fontFamily, mainColor, accentColor) {
  let runs = ''
  let i = 0
  while (i < lineWords.length) {
    const acc = lineWords[i].accent
    const ws = []
    let j = i
    while (j < lineWords.length && lineWords[j].accent === acc) { ws.push(lineWords[j].w); j++ }
    let text = ws.join(' ')
    if (j < lineWords.length) text += ' '
    runs += `<tspan fill="${acc ? accentColor : mainColor}">${svgEscape(text)}</tspan>`
    i = j
  }
  return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="700" letter-spacing="-0.5" text-anchor="start" xml:space="preserve">${runs}</text>`
}

function labelSvg(text, x, y, fontSize, fontFamily, color) {
  if (!text) return ''
  return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="700" letter-spacing="2.4" text-anchor="start" fill="${color}">${svgEscape(String(text).toUpperCase())}</text>`
}

function bylineSvg(staffName, workspaceName, x, y, fontSize, fontFamily, nameColor, subColor) {
  if (!staffName && !workspaceName) return ''
  const name = staffName
    ? `<tspan fill="${nameColor}" font-weight="600">${svgEscape(staffName)}</tspan>`
    : ''
  const sep = staffName && workspaceName ? `<tspan fill="${subColor}"> · </tspan>` : ''
  const ws = workspaceName ? `<tspan fill="${subColor}" font-weight="400">${svgEscape(workspaceName)}</tspan>` : ''
  return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="${fontFamily}" text-anchor="start" xml:space="preserve">${name}${sep}${ws}</text>`
}

// A WHOOP-style ring badge: faint full ring + 78% orange arc + inner disc with
// a figure (e.g. "2") + unit ("min") + small sublabel.
function badgeSvg(cx, cy, r, stroke, figure, unit, sublabel, orange, innerColor, textColor, subColor, fontFamily) {
  const circ = 2 * Math.PI * r
  const arc = circ * 0.78
  const innerR = r - stroke / 2 - 2
  const figSize = Math.round(r * 0.62)
  const unitSize = Math.round(r * 0.30)
  const subSize = Math.round(r * 0.20)
  return `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="${stroke}" />
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${orange}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${arc} ${circ}" transform="rotate(-90 ${cx} ${cy})" />
  <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${innerColor}" />
  ${figure
    // With a figure: big number (+ unit) and the sublabel underneath.
    ? `<text x="${cx}" y="${cy + figSize * 0.15}" font-size="${figSize}" font-family="${fontFamily}" font-weight="700" fill="${textColor}" text-anchor="middle">${svgEscape(String(figure))}<tspan font-size="${unitSize}">${svgEscape(unit || '')}</tspan></text>
  ${sublabel ? `<text x="${cx}" y="${cy + figSize * 0.15 + subSize * 1.6}" font-size="${subSize}" font-family="${fontFamily}" font-weight="600" letter-spacing="1.5" fill="${subColor}" text-anchor="middle">${svgEscape(String(sublabel).toUpperCase())}</text>` : ''}`
    // No figure: center the sublabel alone so the ring never looks empty.
    : (sublabel ? `<text x="${cx}" y="${cy + subSize * 0.5}" font-size="${Math.round(subSize * 1.4)}" font-family="${fontFamily}" font-weight="700" letter-spacing="1.5" fill="${textColor}" text-anchor="middle">${svgEscape(String(sublabel).toUpperCase())}</text>` : '')
  }`
}

// ── Source-photo helpers ────────────────────────────────────────────────────

async function fetchPhotoBuffer(photoUrl) {
  const response = await fetch(photoUrl, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`Source fetch failed: ${response.status}`)
  const clRaw = parseInt(response.headers.get('content-length') || '', 10)
  if (!isNaN(clRaw) && clRaw > 50 * 1024 * 1024) throw new Error(`Source too large: ${clRaw} bytes`)
  const arrayBuf = await response.arrayBuffer()
  if (arrayBuf.byteLength > 50 * 1024 * 1024) throw new Error(`Source too large: ${arrayBuf.byteLength} bytes`)
  return Buffer.from(arrayBuf)
}

async function processPhoto(buf, w, h, mode) {
  const pipe = sharp(buf).rotate().resize(w, h, { fit: 'cover', position: 'attention' })
  if (mode === 'dark') pipe.modulate({ brightness: 0.58, saturation: 0.85 })
  else pipe.modulate({ brightness: 1.05, saturation: 1.04 })
  return pipe.jpeg({ quality: 90 }).toBuffer()
}

// ── Main renderer ───────────────────────────────────────────────────────────

/**
 * @param {Object} p
 * @param {string} [p.photoUrl]
 * @param {Object} p.treatment  — { templateId, headline, accentText, label, figure, figureUnit, aspect }
 * @param {Object} p.workspace
 * @param {string} [p.staffName]
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function renderWhoopPhoto({ photoUrl, treatment = {}, workspace, staffName }) {
  await ensureFontconfig()

  const templateId = WHOOP_TEMPLATE_IDS.includes(treatment.templateId) ? treatment.templateId : 'dark-claim'
  const [width, height] = WHOOP_ASPECTS[treatment.aspect] || WHOOP_ASPECTS['4:5']
  const family = '__bf'
  const { primaryColor: orange, accentColor: sage } = resolveBrandColors(workspace)
  const { buffer: fontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))
  const fontFamily = fontBuffer ? family : 'sans-serif'
  const fontFace = fontBuffer
    ? `<style>@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${fontBuffer.toString('base64')}) format('truetype');}</style>`
    : ''

  const pad = Math.round(width * 0.065)
  const wsName = workspace?.display_name || ''
  const headline = treatment.headline || ''
  const accent = treatment.accentText || ''
  const label = treatment.label || ''
  const isDark = templateId.startsWith('dark')
  const family_id = templateId.split('-')[1] // claim | badge | split

  // Palette per ground.
  const ink = isDark ? '#FFFFFF' : NAVY
  const sub = isDark ? 'rgba(255,255,255,0.66)' : '#475569'
  const labelColor = isDark ? 'rgba(255,255,255,0.72)' : sage
  const bylineSub = isDark ? 'rgba(255,255,255,0.50)' : '#94a3b8'

  // ── CLAIM (no photo) ──────────────────────────────────────────────────────
  if (family_id === 'claim') {
    const fs = Math.round(width * 0.092)
    const lh = Math.round(fs * 1.0)
    const lines = layoutHeadline(headline, accent, Math.round((width - 2 * pad) / (fs * 0.50)), 4)
    const blockH = lines.length * lh
    const startY = Math.round(height * 0.50) - Math.round(blockH / 2) + fs
    const headlineSvg = lines.map((ln, i) => lineSvg(ln, pad, startY + i * lh, fs, fontFamily, ink, orange)).join('\n')

    const labelY = Math.round(height * 0.11)
    const ruleY = labelY - Math.round(fs * 0.16)
    const ruleW = Math.round(width * 0.07)
    const bgDef = isDark
      ? `<radialGradient id="g" cx="80%" cy="0%" r="120%"><stop offset="0" stop-color="${NAVY_RADIAL}"/><stop offset="0.6" stop-color="${NAVY}"/></radialGradient>`
      : ''
    const bgFill = isDark ? 'url(#g)' : PAPER
    const subY = startY + blockH + Math.round(fs * 0.35)
    const subText = treatment.sub || ''
    const bylineY = height - Math.round(height * 0.075)

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFace}${bgDef}</defs>
  <rect width="${width}" height="${height}" fill="${bgFill}"/>
  <rect x="${pad}" y="${ruleY}" width="${ruleW}" height="4" rx="2" fill="${orange}"/>
  ${labelSvg(label, pad + ruleW + Math.round(width * 0.02), labelY, Math.round(width * 0.026), fontFamily, labelColor)}
  ${headlineSvg}
  ${subText ? `<text x="${pad}" y="${subY}" font-size="${Math.round(width * 0.028)}" font-family="${fontFamily}" fill="${sub}">${svgEscape(subText)}</text>` : ''}
  ${bylineSvg(staffName, wsName, pad, bylineY, Math.round(width * 0.026), fontFamily, ink, bylineSub)}
</svg>`
    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92, progressive: true }).toBuffer()
    return { buffer, width, height }
  }

  // ── SPLIT (photo top, solid panel bottom) ─────────────────────────────────
  if (family_id === 'split') {
    const panelColor = isDark ? NAVY : SAGE_PANEL
    const topH = Math.round(height * 0.46)
    const base = sharp({ create: { width, height, channels: 3, background: panelColor } })
    let composites = []
    if (photoUrl) {
      const photo = await processPhoto(await fetchPhotoBuffer(photoUrl), width, topH, 'bright')
      composites.push({ input: photo, top: 0, left: 0 })
    }
    const fs = Math.round(width * 0.066)
    const lh = Math.round(fs * 1.02)
    const lines = layoutHeadline(headline, accent, Math.round((width - 2 * pad) / (fs * 0.50)), 3)
    const panelTop = topH
    const labelY = panelTop + Math.round(height * 0.075)
    const ruleY = labelY - Math.round(fs * 0.22)
    const ruleW = Math.round(width * 0.06)
    const headStartY = labelY + Math.round(fs * 0.9)
    const headlineSvg = lines.map((ln, i) => lineSvg(ln, pad, headStartY + i * lh, fs, fontFamily, ink, orange)).join('\n')
    const bylineY = height - Math.round(height * 0.06)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFace}</defs>
  <rect x="${pad}" y="${ruleY}" width="${ruleW}" height="4" rx="2" fill="${orange}"/>
  ${labelSvg(label, pad + ruleW + Math.round(width * 0.02), labelY, Math.round(width * 0.024), fontFamily, labelColor)}
  ${headlineSvg}
  ${bylineSvg(staffName, wsName, pad, bylineY, Math.round(width * 0.024), fontFamily, ink, bylineSub)}
</svg>`
    composites.push({ input: Buffer.from(svg), top: 0, left: 0 })
    const buffer = await base.composite(composites).jpeg({ quality: 92, progressive: true }).toBuffer()
    return { buffer, width, height }
  }

  // ── BADGE (photo + ring badge + headline) ─────────────────────────────────
  // dark-badge: full-bleed dark-graded photo + bottom scrim.
  // light-badge: bright photo top (~58%) + white panel bottom.
  const figure = treatment.figure || ''
  const figureUnit = treatment.figureUnit || ''
  const r = Math.round(width * 0.085)
  const stroke = Math.round(r * 0.16)
  const badgeCx = width - pad - r
  const fs = Math.round(width * 0.062)
  const lh = Math.round(fs * 1.04)
  const lines = layoutHeadline(headline, accent, Math.round((width - 2 * pad) / (fs * 0.50)), 3)

  if (isDark) {
    const photo = photoUrl
      ? await processPhoto(await fetchPhotoBuffer(photoUrl), width, height, 'dark')
      : await sharp({ create: { width, height, channels: 3, background: NAVY } }).jpeg().toBuffer()
    const headBlockH = lines.length * lh
    const headStartY = height - Math.round(height * 0.16) - headBlockH + fs
    const labelY = headStartY - fs - Math.round(fs * 0.35)
    const ruleY = labelY - Math.round(fs * 0.22)
    const ruleW = Math.round(width * 0.055)
    const headlineSvg = lines.map((ln, i) => lineSvg(ln, pad, headStartY + i * lh, fs, fontFamily, '#FFFFFF', orange)).join('\n')
    const badgeCy = pad + r
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFace}<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0.40" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.80" stop-color="${NAVY}" stop-opacity="0.62"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.92"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#scrim)"/>
  ${badgeSvg(badgeCx, badgeCy, r, stroke, figure, figureUnit, treatment.figureLabel || 'fix', orange, NAVY, '#FFFFFF', 'rgba(255,255,255,0.55)', fontFamily)}
  <rect x="${pad}" y="${ruleY}" width="${ruleW}" height="4" rx="2" fill="${orange}"/>
  ${labelSvg(label, pad + ruleW + Math.round(width * 0.02), labelY, Math.round(width * 0.022), fontFamily, 'rgba(255,255,255,0.72)')}
  ${headlineSvg}
  ${bylineSvg(staffName, wsName, pad, height - Math.round(height * 0.06), Math.round(width * 0.024), fontFamily, '#FFFFFF', 'rgba(255,255,255,0.55)')}
</svg>`
    const buffer = await sharp(photo).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 90, progressive: true }).toBuffer()
    return { buffer, width, height }
  }

  // light-badge
  const topH = Math.round(height * 0.58)
  const base = sharp({ create: { width, height, channels: 3, background: '#FFFFFF' } })
  const composites = []
  if (photoUrl) {
    const photo = await processPhoto(await fetchPhotoBuffer(photoUrl), width, topH, 'bright')
    composites.push({ input: photo, top: 0, left: 0 })
  }
  const labelY = topH + Math.round(height * 0.065)
  const ruleY = labelY - Math.round(fs * 0.22)
  const ruleW = Math.round(width * 0.055)
  const headStartY = labelY + Math.round(fs * 0.9)
  const headlineSvg = lines.map((ln, i) => lineSvg(ln, pad, headStartY + i * lh, fs, fontFamily, NAVY, orange)).join('\n')
  const badgeCy = topH - r - Math.round(width * 0.04)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFace}</defs>
  ${badgeSvg(badgeCx, badgeCy, r, stroke, figure, figureUnit, treatment.figureLabel || 'fix', orange, '#FFFFFF', NAVY, sage, fontFamily)}
  <rect x="${pad}" y="${ruleY}" width="${ruleW}" height="4" rx="2" fill="${orange}"/>
  ${labelSvg(label, pad + ruleW + Math.round(width * 0.02), labelY, Math.round(width * 0.022), fontFamily, sage)}
  ${headlineSvg}
  ${bylineSvg(staffName, wsName, pad, height - Math.round(height * 0.055), Math.round(width * 0.024), fontFamily, NAVY, '#94a3b8')}
</svg>`
  composites.push({ input: Buffer.from(svg), top: 0, left: 0 })
  const buffer = await base.composite(composites).jpeg({ quality: 90, progressive: true }).toBuffer()
  return { buffer, width, height }
}
