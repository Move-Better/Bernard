// V3 — static reframe + timed manual text overlays for the Reel editor bake.
//
// Pure string/Buffer helpers (no I/O) so they're unit-testable in the node
// harness. Consumed by brandRenderVideo.js:
//   - reframeFilter()   → the cover+zoom+pan scale/crop filter producing [scaled]
//   - buildOverlaySvg() → a full-frame transparent SVG for ONE manual overlay,
//                         rasterised to PNG (Sharp) and composited with an
//                         `overlay=…:enable='between(t,in,out)'` time window.
//
// The overlay model mirrors the carousel text-block (role / position / size /
// colour) + a time window — "the photo editor's text layer, plus time."

function svgEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrapLines(text, maxCharsPerLine, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length <= maxCharsPerLine) cur = next
    else { if (cur) lines.push(cur); cur = w; if (lines.length >= maxLines) break }
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  return lines.length ? lines : ['']
}

const clamp01 = (v, dflt = 0.5) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : dflt
}

/**
 * Neutral reframe = full cover, centered, no zoom — identical to the legacy
 * `scale=W:H:increase,crop=W:H`. Lets the caller skip the reframe path entirely
 * so an un-reframed clip renders byte-identically to before.
 */
export function isNeutralReframe(reframe) {
  if (!reframe || typeof reframe !== 'object') return true
  const z = Number(reframe.zoom), x = Number(reframe.x), y = Number(reframe.y)
  const zN = !Number.isFinite(z) || Math.abs(z - 100) < 0.5
  const xN = !Number.isFinite(x) || Math.abs(x - 50) < 0.5
  const yN = !Number.isFinite(y) || Math.abs(y - 50) < 0.5
  return zN && xN && yN
}

/**
 * Cover + zoom + pan scale/crop filter producing [scaled].
 *   zoom — percent (100 = cover at native; >100 zooms IN)
 *   x/y  — 0..100, CSS background-position semantics (0 = left/top, 100 = right/bottom)
 * At {zoom:100,x:50,y:50} this is exactly the legacy centered cover.
 */
export function reframeFilter(reframe, W, H) {
  const z = Math.max(1, (Number(reframe?.zoom) || 100) / 100)
  // x/y default to 50 (centre) when missing; clamp01 maps the /100 to [0,1].
  const px = Number.isFinite(Number(reframe?.x)) ? Number(reframe.x) : 50
  const py = Number.isFinite(Number(reframe?.y)) ? Number(reframe.y) : 50
  const x = clamp01(px / 100)
  const y = clamp01(py / 100)
  const sw = Math.round(W * z)
  const sh = Math.round(H * z)
  return `[0:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,` +
    `crop=${W}:${H}:(in_w-${W})*${x.toFixed(4)}:(in_h-${H})*${y.toFixed(4)}[scaled]`
}

const OVERLAY_ROLE_FS = { title: 0.055, lower_third: 0.034, callout: 0.042 }

/**
 * Sanitize + clamp an overlays array against the clip duration. Drops empty /
 * out-of-window entries, clamps in/out, caps the count (bounds ffmpeg inputs).
 * Returns [] for anything not renderable.
 */
export function normalizeOverlays(overlays, clipDur, max = 6) {
  if (!Array.isArray(overlays)) return []
  const out = []
  for (const o of overlays) {
    if (!o || typeof o !== 'object') continue
    const text = String(o.text || '').trim()
    if (!text) continue
    let inT = Number.isFinite(Number(o.in)) ? Math.max(0, Number(o.in)) : 0
    let outT = Number.isFinite(Number(o.out)) ? Number(o.out) : clipDur
    outT = Math.min(outT, clipDur)
    if (outT <= inT) continue
    out.push({
      role: ['title', 'lower_third', 'callout'].includes(o.role) ? o.role : 'title',
      text: text.slice(0, 200),
      x: clamp01(o.x), y: clamp01(o.y),
      size: Math.max(0.4, Math.min(2.5, Number(o.size) || 1)),
      color: /^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : '#FFFFFF',
      in: inT, out: outT,
    })
    if (out.length >= max) break
  }
  return out
}

/**
 * Full-frame transparent SVG with ONE overlay's text positioned at its x/y.
 *   title       — bold text + drop-shadow
 *   lower_third — text on a dark rounded box
 *   callout     — text on an accent rounded box
 * Mirrors the editor canvas overlay (renderFreeformSlide block) so preview==publish.
 */
export function buildOverlaySvg({ width, height, overlay, accentColor = '#0C7580', fontBuffer }) {
  const o = overlay || {}
  const role = ['title', 'lower_third', 'callout'].includes(o.role) ? o.role : 'title'
  const baseDim = Math.min(width, height)
  const sizeScale = Math.max(0.4, Math.min(2.5, Number(o.size) || 1))
  const fs = Math.round(baseDim * OVERLAY_ROLE_FS[role] * sizeScale)
  const color = /^#[0-9a-fA-F]{6}$/.test(o.color || '') ? o.color : '#FFFFFF'
  const cx = Math.round(clamp01(o.x) * width)
  const cy = Math.round(clamp01(o.y) * height)

  const maxChars = Math.max(8, Math.round((width * 0.84) / (fs * 0.55)))
  const lines = wrapLines(o.text, maxChars, 3)
  const lineH = Math.round(fs * 1.18)
  const blockH = lines.length * lineH
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0)
  const textW = Math.round(longest * fs * 0.55)

  const fontFamily = fontBuffer ? 'BrandFont' : 'sans-serif'
  const fontFaceCss = fontBuffer
    ? `<style>@font-face{font-family:'BrandFont';src:url(data:font/ttf;base64,${fontBuffer.toString('base64')}) format('truetype');}</style>`
    : ''

  const firstBaseline = cy - blockH / 2 + fs
  const tspans = lines.map((l, i) =>
    `<text x="${cx}" y="${Math.round(firstBaseline + i * lineH)}" font-size="${fs}" fill="${color}" ` +
    `text-anchor="middle" font-family="${fontFamily}" font-weight="${role === 'title' ? 800 : 700}"` +
    `${role === 'title' ? ' filter="url(#sh)"' : ''}>${svgEscape(l)}</text>`
  ).join('\n')

  let box = ''
  if (role === 'lower_third' || role === 'callout') {
    const padX = Math.round(fs * 0.6), padY = Math.round(fs * 0.4)
    const bw = textW + 2 * padX, bh = blockH + 2 * padY
    const bx = Math.round(cx - bw / 2), by = Math.round(cy - bh / 2)
    const r = Math.round(fs * 0.25)
    const fill = role === 'callout' ? accentColor : '#0C1A2E'
    const op = role === 'callout' ? 0.92 : 0.62
    box = `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${r}" ry="${r}" fill="${fill}" fill-opacity="${op}" />`
  }

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${fontFaceCss}<filter id="sh" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="2" stdDeviation="${Math.round(fs * 0.08)}" flood-color="#000000" flood-opacity="0.55"/></filter></defs>` +
    `${box}${tspans}</svg>`,
  )
}
