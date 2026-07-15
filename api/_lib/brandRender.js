// Brand-styled photo rendering for the Phase 2 Day 7 editorial pipeline.
//
// Takes a source photo + caption + workspace brand context and produces a
// per-channel rendered image (1:1, 9:16, 16:9, etc.) with:
//   • Photo cropped + resized to the channel's aspect ratio
//   • Caption text in a top or bottom band
//   • Lower-third strip with clinician name + workspace name
//   • Workspace primary color as the accent
//
// Color + opacity resolution order (most specific → least):
//   1. workspace.colors.primary           — user-set in Brand Kit
//   2. workspace.brand_style.accent_color — extracted from Brand Book
//   3. workspace.brand_visual_identity.colorPalette.* — Day 9 Vision analysis
//   4. Hardcoded DEFAULT_PRIMARY / DEFAULT_ACCENT
//
// Font resolution: see api/_lib/brandFonts.js. The font is embedded into
// the SVG via @font-face data-URI so librsvg renders text correctly without
// fontconfig — fixes the garbled-text bug in the video render pipeline
// (Sharp SVG→PNG path was falling through to a tofu fallback font).

import sharp from 'sharp'
import satori from 'satori'
import { Readable } from 'node:stream'
import { getBrandFont, ensureFontconfig, getFallbackFontBuffer } from './brandFonts.js'
import { applyGradeParamsSharp } from './gradeParams.js'

const MAX_SOURCE_BYTES = 50 * 1024 * 1024

/**
 * Fetch a source photo into a Buffer with the 50MB cap enforced DURING the
 * download. `response.arrayBuffer()` reads the entire body into the JS heap
 * before any size check can run, so a >50MB image (common when Content-Length
 * is absent on chunked Blob/CDN responses) fully materializes in RAM before
 * being rejected — concurrent large composes can then OOM the function. Reading
 * chunk-by-chunk lets us stop and throw the moment the cap is exceeded, so peak
 * heap is bounded by the cap rather than the source size. The returned Buffer is
 * identical to the old path, so the Sharp pipeline is unchanged.
 */
async function fetchSourcePhotoBuffer(photoUrl) {
  const response = await fetch(photoUrl)
  if (!response.ok) throw new Error(`Source fetch failed: ${response.status}`)
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_SOURCE_BYTES) throw new Error(`Source too large: ${contentLength} bytes`)
  if (!response.body) {
    // No readable stream (shouldn't happen on Node fetch); fall back to buffering.
    const arrayBuf = await response.arrayBuffer()
    if (arrayBuf.byteLength > MAX_SOURCE_BYTES) throw new Error(`Source too large: ${arrayBuf.byteLength} bytes`)
    return Buffer.from(arrayBuf)
  }
  const reader = response.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.length
    if (received > MAX_SOURCE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error(`Source too large: ${received} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

// Channel specs. Width × height in pixels. Add new channels here.
export const CHANNEL_SPECS = {
  linkedin_feed:        { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  instagram_reel_still: { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  instagram_feed:       { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  facebook_feed:        { width: 1080, height: 1350, aspect: '4:5',  captionPos: 'top' },
  blog_hero:            { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom' },
  tiktok_still:         { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  youtube_short_still:  { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
}

const DEFAULT_PRIMARY = '#1a3a5c'   // navy fallback
const DEFAULT_ACCENT  = '#83957C'

/**
 * Resolve the caption band primary color, accent color, and overlay opacity
 * for a workspace using the priority chain in the file header comment.
 * Exported so brandRenderVideo.js stays DRY.
 */
export function resolveBrandColors(workspace) {
  const colors = workspace?.colors || {}
  const brandStyle = workspace?.brand_style || {}
  const visual = workspace?.brand_visual_identity || {}
  const palette = visual.colorPalette || {}

  return {
    primaryColor: colors.primary
      || brandStyle.accent_color
      || palette.foreground
      || DEFAULT_PRIMARY,
    // KEEP IN SYNC: src/lib/brandSwatches.js workspaceCaptionAccent() mirrors
    // this accent chain client-side (the video editor seeds caption.accent
    // from it so the karaoke preview matches this bake-side fallback).
    accentColor: colors.accent
      || palette.accent
      || DEFAULT_ACCENT,
    captionOpacity: typeof visual.recommendedOverlayOpacity === 'number'
      ? Math.min(Math.max(visual.recommendedOverlayOpacity, 0.5), 1.0)
      : 0.88,
  }
}

/**
 * Escape a string for safe inclusion as SVG text content.
 */
function svgEscape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── Satori helpers ───────────────────────────────────────────────────────────
// Minimal hyperscript so we can build Satori element trees without a JSX
// transform — Vercel Node functions don't transpile JSX in api/. Produces the
// React-element-like `{ type, props }` shape Satori consumes.
function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c != null && c !== false)
  return {
    type,
    props: {
      ...(props || {}),
      children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids,
    },
  }
}

function hexToRgba(hex, a) {
  const m = String(hex || '').replace('#', '')
  if (m.length < 6) return `rgba(0,0,0,${a})`
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/**
 * Naive word-wrap that splits text into lines based on character count.
 * Returns up to maxLines lines; the last line is truncated with an ellipsis
 * if more text remains.
 */
function wrapLines(text, maxCharsPerLine, maxLines) {
  const words = String(text || '').trim().split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxCharsPerLine) {
      current = next
    } else {
      if (current) lines.push(current)
      current = word
      if (lines.length >= maxLines) break
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length + 1) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:!?\s]+$/, '') + '…'
  }
  return lines
}

/**
 * Build the SVG overlay for a given channel.
 * Returns a Buffer suitable for Sharp's `composite()`.
 *
 * @param {Object} params
 * @param {number} params.width / height / captionPos / ...
 * @param {Buffer} [params.fontBuffer]   — TTF font Buffer (embedded via @font-face data-URI).
 *                                         If omitted, falls back to font-family: 'sans-serif'.
 * @param {number} [params.captionOpacity=0.88]
 */
export function buildBrandOverlaySvg({
  width,
  height,
  captionPos,
  captionText,
  staffName,
  workspaceName,
  primaryColor,
  accentColor,
  fontBuffer,
  captionOpacity = 0.88,
  captionSizeScale = 1,
}) {
  // Layout constants — proportional to the smaller dimension so they scale
  // sensibly across 1:1, 9:16, and 16:9.
  const baseDim = Math.min(width, height)
  const captionBandHeight = Math.round(baseDim * 0.18)
  const captionBandY = captionPos === 'top'
    ? 0
    : captionPos === 'center'
      ? Math.round((height - captionBandHeight) / 2)
      : (height - captionBandHeight)
  const lowerThirdHeight = Math.round(baseDim * 0.09)
  const lowerThirdY = height - lowerThirdHeight

  const captionFontSize = Math.round(baseDim * 0.048 * captionSizeScale)
  const captionSidePadding = Math.round(width * 0.05)
  const captionInnerWidth = width - (2 * captionSidePadding)
  const maxCharsPerLine = Math.max(14, Math.round(captionInnerWidth / (captionFontSize * 0.55)))
  // Cap lines so the block fits inside the band including ascender/descender.
  // Bottom-band channels (16:9 blog_hero / blog_hero_video) get a tighter cap:
  // their wider canvas inflates maxCharsPerLine, so 3 lines pack ~180 chars and
  // visually overflow the band even though baseline math says it fits. Forcing
  // 2 lines triggers the same ellipsis truncation already used on top-band
  // channels and keeps text cleanly inside the orange band.
  const maxLines = captionPos === 'bottom' ? 2 : 3
  const captionLines = wrapLines(captionText, maxCharsPerLine, maxLines)

  const lowerFontSize = Math.round(baseDim * 0.030)
  const lowerLeftText = svgEscape(staffName || '')
  const lowerRightText = svgEscape(workspaceName || '')

  const captionLineHeight = Math.round(captionFontSize * 1.2)
  const captionBlockHeight = captionLines.length * captionLineHeight
  const captionStartY = captionBandY + Math.round((captionBandHeight - captionBlockHeight) / 2) + captionFontSize

  // Font: embed as @font-face data-URI if a TTF buffer was supplied.
  // This makes the SVG self-contained — librsvg can render text without
  // depending on fontconfig or system fonts.
  const fontFamily = fontBuffer ? 'BrandFont' : 'sans-serif'
  const fontFaceCss = fontBuffer
    ? `<style>@font-face { font-family: 'BrandFont'; src: url(data:font/ttf;base64,${fontBuffer.toString('base64')}) format('truetype'); }</style>`
    : ''

  const captionTspans = captionLines.map((line, i) => {
    const y = captionStartY + (i * captionLineHeight)
    return `<text x="${Math.round(width / 2)}" y="${y}" font-size="${captionFontSize}" fill="#FFFFFF" text-anchor="middle" font-family="${fontFamily}" font-weight="700">${svgEscape(line)}</text>`
  }).join('\n')

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFaceCss}</defs>

  <!-- Caption band -->
  <rect x="0" y="${captionBandY}" width="${width}" height="${captionBandHeight}" fill="${primaryColor}" fill-opacity="${captionOpacity}" />
  ${captionLines.length ? captionTspans : ''}

  <!-- Accent bar above lower-third -->
  <rect x="0" y="${lowerThirdY - 4}" width="${width}" height="4" fill="${accentColor}" />

  <!-- Lower-third bar -->
  <rect x="0" y="${lowerThirdY}" width="${width}" height="${lowerThirdHeight}" fill="#000000" fill-opacity="0.78" />
  <text x="${Math.round(width * 0.05)}" y="${lowerThirdY + Math.round(lowerThirdHeight * 0.62)}" font-size="${lowerFontSize}" fill="#FFFFFF" font-family="${fontFamily}" font-weight="500">${lowerLeftText}</text>
  <text x="${Math.round(width * 0.95)}" y="${lowerThirdY + Math.round(lowerThirdHeight * 0.62)}" font-size="${lowerFontSize}" fill="#FFFFFF" font-family="${fontFamily}" font-weight="400" text-anchor="end">${lowerRightText}</text>
</svg>`)
}

/**
 * Render one channel's worth of a photo asset.
 */
export async function renderPhotoChannel({ photoUrl, channel, captionText, workspace, staffName }) {
  const spec = CHANNEL_SPECS[channel]
  if (!spec) {
    throw new Error(`Unknown channel: ${channel}`)
  }

  // Initialise fontconfig before any Sharp SVG work (writes /tmp/fonts.conf,
  // sets FONTCONFIG_FILE env var). No-op after first call.
  await ensureFontconfig()

  // Fetch source photo into memory. Cap at 50MB (enforced during download) to
  // avoid surprise OOMs when Content-Length is absent on chunked CDN responses.
  const buffer = await fetchSourcePhotoBuffer(photoUrl)

  // Resize + crop the source to the channel aspect (cover fit, centered).
  const photoLayer = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize(spec.width, spec.height, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 88 })
    .toBuffer()

  // Resolve brand colors + opacity (workspace → brand_style → visual identity → defaults)
  const { primaryColor, accentColor, captionOpacity } = resolveBrandColors(workspace)

  // Resolve brand font (workspace.brand_style.heading_font → Google Fonts → bundled Inter)
  const { buffer: fontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))

  const overlaySvg = buildBrandOverlaySvg({
    width: spec.width,
    height: spec.height,
    captionPos: spec.captionPos,
    captionText,
    staffName,
    workspaceName: workspace?.display_name || '',
    primaryColor,
    accentColor,
    fontBuffer,
    captionOpacity,
  })

  // Composite SVG over the photo.
  const out = await sharp(photoLayer)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .jpeg({ quality: 88, progressive: true })
    .toBuffer()

  return { buffer: out, width: spec.width, height: spec.height, channel }
}

// ── Editorial photo compositor (Photo Compositor P1) ────────────────────────
//
// The "above-middle" look: a graded photo + a bottom gradient scrim + a baked
// headline in the brand heading font + a thin accent rule and the author name.
// Distinct from renderPhotoChannel's solid caption band — this is the editorial
// template the StoryboardPiece compositor drives. Reuses the same Sharp + SVG +
// embedded-font pipeline (no fontconfig dependency).

const EDITORIAL_ASPECTS = {
  '4:5':  [1080, 1350],
  '9:16': [1080, 1920],
  '1:1':  [1080, 1080],
  '16:9': [1920, 1080], // YouTube in-stream / Google Display — added for ad export
}
const HEADLINE_SIZE_FACTOR = { s: 0.058, m: 0.070, l: 0.084 }
const DEFAULT_SCRIM = '#10243f' // brand navy

/**
 * Build the editorial overlay SVG: bottom scrim gradient (guarantees the
 * headline is legible over any photo — the P1 "contrast-aware" guarantee),
 * a left-aligned wrapped headline in the brand font, and an accent rule +
 * author/workspace name row pinned to the bottom.
 */
export function buildEditorialOverlaySvg({
  width,
  height,
  headline,
  headlineSize = 'm',
  staffName,
  workspaceName,
  accentColor,
  scrimColor = DEFAULT_SCRIM,
  fontBuffer,
}) {
  const baseDim = Math.min(width, height)
  const pad = Math.round(width * 0.06)

  const fontFamily = fontBuffer ? 'BrandFont' : 'sans-serif'
  const fontFaceCss = fontBuffer
    ? `<style>@font-face { font-family: 'BrandFont'; src: url(data:font/ttf;base64,${fontBuffer.toString('base64')}) format('truetype'); }</style>`
    : ''

  // Bottom name row.
  const nameFontSize = Math.round(baseDim * 0.026)
  const bottomMargin = Math.round(height * 0.055)
  const nameBaseline = height - bottomMargin
  const ruleW = Math.round(width * 0.045)
  const ruleH = Math.max(3, Math.round(baseDim * 0.005))
  const ruleY = Math.round(nameBaseline - nameFontSize * 0.55) - ruleH
  const nameX = pad + ruleW + Math.round(width * 0.018)
  const nameRow = (staffName || workspaceName)
    ? `<rect x="${pad}" y="${ruleY}" width="${ruleW}" height="${ruleH}" rx="${Math.round(ruleH / 2)}" fill="${accentColor}" />
  <text x="${nameX}" y="${nameBaseline}" font-size="${nameFontSize}" fill="#FFFFFF" font-family="${fontFamily}" font-weight="600">${svgEscape(staffName || '')}</text>
  ${staffName && workspaceName ? `<text x="${nameX + Math.round(width * 0.012) + (staffName.length * nameFontSize * 0.5)}" y="${nameBaseline}" font-size="${nameFontSize}" fill="rgba(255,255,255,0.72)" font-family="${fontFamily}" font-weight="400">· ${svgEscape(workspaceName)}</text>` : (workspaceName && !staffName ? `<text x="${nameX}" y="${nameBaseline}" font-size="${nameFontSize}" fill="rgba(255,255,255,0.85)" font-family="${fontFamily}" font-weight="500">${svgEscape(workspaceName)}</text>` : '')}`
    : ''

  // Headline block, stacked up from just above the name row.
  const fs = Math.round(width * (HEADLINE_SIZE_FACTOR[headlineSize] || HEADLINE_SIZE_FACTOR.m))
  const lineHeight = Math.round(fs * 1.12)
  const maxChars = Math.max(12, Math.round((width - 2 * pad) / (fs * 0.52)))
  const lines = wrapLines(headline, maxChars, 3)
  const blockBottom = nameBaseline - nameFontSize - Math.round(height * 0.03)
  const firstBaseline = blockBottom - (lines.length - 1) * lineHeight
  const headlineTspans = lines.map((line, i) =>
    `<text x="${pad}" y="${firstBaseline + i * lineHeight}" font-size="${fs}" fill="#FFFFFF" font-family="${fontFamily}" font-weight="800" letter-spacing="-0.5">${svgEscape(line)}</text>`,
  ).join('\n  ')

  // Scrim covers roughly the bottom 55% so it reads as intentional, not a bar.
  const scrimStart = 0.42

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>${fontFaceCss}
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="${scrimStart}" stop-color="${scrimColor}" stop-opacity="0" />
      <stop offset="0.78" stop-color="${scrimColor}" stop-opacity="0.55" />
      <stop offset="1" stop-color="${scrimColor}" stop-opacity="0.86" />
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#scrim)" />
  ${lines.length ? headlineTspans : ''}
  ${nameRow}
</svg>`)
}

/**
 * Satori (flexbox + real font metrics) version of buildEditorialOverlaySvg.
 *
 * Returns an SVG STRING with text baked to vector <path> elements, so there is
 * no font dependency at raster time — this removes the @font-face data-URI /
 * fontconfig workaround the legacy builder needs and the tofu-fallback risk.
 * The headline wraps by measured glyph widths (vs the legacy `fs * 0.52`
 * char-count estimate) and the "· workspace" run lays out via a flex row
 * (vs the legacy `staffName.length * nameFontSize * 0.5` position guess).
 */
export async function buildEditorialOverlaySvgSatori({
  width,
  height,
  headline,
  headlineSize = 'm',
  staffName,
  workspaceName,
  accentColor,
  scrimColor = DEFAULT_SCRIM,
  fontBuffer,
}) {
  const baseDim = Math.min(width, height)
  const pad = Math.round(width * 0.06)
  const fs = Math.round(width * (HEADLINE_SIZE_FACTOR[headlineSize] || HEADLINE_SIZE_FACTOR.m))
  const nameFs = Math.round(baseDim * 0.026)
  const ruleW = Math.round(width * 0.045)
  const ruleH = Math.max(3, Math.round(baseDim * 0.005))

  const scrim = h('div', {
    style: {
      position: 'absolute', top: 0, left: 0, width, height, display: 'flex',
      backgroundImage: `linear-gradient(180deg, ${hexToRgba(scrimColor, 0)} 42%, ${hexToRgba(scrimColor, 0.55)} 78%, ${hexToRgba(scrimColor, 0.86)} 100%)`,
    },
  })

  const headlineEl = headline
    ? h('div', {
      style: {
        display: 'flex', maxWidth: width - 2 * pad, color: '#fff', fontFamily: 'Brand',
        fontWeight: 800, fontSize: fs, lineHeight: 1.12, letterSpacing: -0.5,
      },
    }, String(headline))
    : null

  const nameRow = (staffName || workspaceName)
    ? h('div', { style: { display: 'flex', alignItems: 'center', marginTop: Math.round(height * 0.03) } },
      h('div', { style: { width: ruleW, height: ruleH, borderRadius: ruleH / 2, backgroundColor: accentColor, marginRight: Math.round(width * 0.018), display: 'flex' } }),
      staffName ? h('div', { style: { display: 'flex', color: '#fff', fontFamily: 'Brand', fontWeight: 600, fontSize: nameFs } }, String(staffName)) : null,
      (staffName && workspaceName)
        ? h('div', { style: { display: 'flex', color: 'rgba(255,255,255,0.72)', fontFamily: 'Brand', fontWeight: 400, fontSize: nameFs, marginLeft: Math.round(width * 0.012) } }, `· ${workspaceName}`)
        : (workspaceName ? h('div', { style: { display: 'flex', color: 'rgba(255,255,255,0.85)', fontFamily: 'Brand', fontWeight: 500, fontSize: nameFs } }, String(workspaceName)) : null),
    )
    : null

  const tree = h('div', {
    style: {
      width, height, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
      position: 'relative', paddingLeft: pad, paddingRight: pad, paddingBottom: Math.round(height * 0.055),
    },
  }, scrim, headlineEl, nameRow)

  return satori(tree, {
    width,
    height,
    fonts: [
      { name: 'Brand', data: fontBuffer, weight: 400, style: 'normal' },
      { name: 'Brand', data: fontBuffer, weight: 600, style: 'normal' },
      { name: 'Brand', data: fontBuffer, weight: 800, style: 'normal' },
    ],
  })
}

/**
 * Fetches + rasterizes a Brand Kit logo asset (SVG or raster) and returns a
 * Sharp composite descriptor positioned bottom-right of the editorial footer,
 * vertically centered on the name-row band. Returns null on any failure —
 * a missing/broken logo asset must never break a publish.
 */
async function buildLogoCompositeLayer(logoUrl, width, height) {
  try {
    const raw = await fetchSourcePhotoBuffer(logoUrl)
    const baseDim = Math.min(width, height)
    const pad = Math.round(width * 0.06)
    const logoWidthPx = Math.round(width * 0.16)
    const logo = await sharp(raw, { density: 300 })
      .resize({ width: logoWidthPx })
      .png()
      .toBuffer()
    const { height: logoH } = await sharp(logo).metadata()
    // Match buildEditorialOverlaySvg's name-row geometry so the logo sits on
    // the same visual band as the staff/workspace name text.
    const bottomMargin = Math.round(height * 0.055)
    const nameBaseline = height - bottomMargin
    const nameFontSize = Math.round(baseDim * 0.026)
    const bandCenterY = nameBaseline - Math.round(nameFontSize * 0.35)
    return {
      input: logo,
      left: width - pad - logoWidthPx,
      top: Math.max(0, bandCenterY - Math.round((logoH || logoWidthPx * 0.3) / 2)),
    }
  } catch (e) {
    console.warn('[brandRender] logo composite failed, skipping:', e?.message || e)
    return null
  }
}

/**
 * Render one editorial composite from a source photo + treatment spec.
 * Applies a subtle grade (brightness/saturation) and a subject-aware ("smart")
 * crop, then composites the editorial overlay.
 *
 * @param {Object} params
 * @param {string} params.photoUrl
 * @param {Object} params.treatment  — { headline, headlineSize, grade (0-100), aspect, scrim }
 * @param {Object} params.workspace
 * @param {string} [params.staffName]
 * @param {string} [params.logoUrl] — Brand Kit logo asset to stamp in the footer, if the
 *   workspace's "Logo on editorial cards" toggle is on. Skipped when absent.
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function renderEditorialPhoto({ photoUrl, treatment = {}, workspace, staffName, logoUrl }) {
  await ensureFontconfig()

  const [width, height] = EDITORIAL_ASPECTS[treatment.aspect] || EDITORIAL_ASPECTS['4:5']

  const buffer = await fetchSourcePhotoBuffer(photoUrl)

  // Grade. NEW treatments carry a full `gradeParams` object (the colorist:
  // exposure/contrast/saturation/warmth/tint/depth) applied by the shared,
  // format-agnostic engine. LEGACY treatments (no gradeParams) keep the exact
  // single-scalar brightness/saturation lift below so historical renders are
  // byte-identical.
  const g = Math.min(Math.max(Number(treatment.grade ?? 40), 0), 100) / 100
  let gradePipe = sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize(width, height, { fit: 'cover', position: 'attention' }) // subject-aware crop
  gradePipe = treatment.gradeParams
    ? applyGradeParamsSharp(gradePipe, treatment.gradeParams)
    : gradePipe.modulate({ brightness: 1 + g * 0.12, saturation: 1 + g * 0.18 })
  const photoLayer = await gradePipe.jpeg({ quality: 90 }).toBuffer()

  const { primaryColor, accentColor } = resolveBrandColors(workspace)
  const { buffer: brandFontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))
  // Satori requires a non-null font; guarantee the bundled Inter as last resort.
  const fontBuffer = brandFontBuffer || await getFallbackFontBuffer().catch(() => null)

  const overlayParams = {
    width,
    height,
    headline: treatment.headline || '',
    headlineSize: treatment.headlineSize || 'm',
    staffName,
    workspaceName: workspace?.display_name || '',
    accentColor,
    scrimColor: treatment.scrim === 'brand' ? primaryColor : DEFAULT_SCRIM,
    fontBuffer,
  }

  // Satori (real font metrics, vector text) first; fall back to the legacy
  // SVG-string overlay if Satori/yoga is unavailable at runtime so the publish
  // path never breaks. Satori output is rasterised to PNG, then composited the
  // same way the legacy SVG buffer is.
  let overlayInput
  try {
    if (!fontBuffer) throw new Error('no font buffer available for satori')
    const satoriSvg = await buildEditorialOverlaySvgSatori(overlayParams)
    overlayInput = await sharp(Buffer.from(satoriSvg)).png().toBuffer()
  } catch (e) {
    console.warn('[brandRender] satori overlay failed, using legacy overlay:', e?.message || e)
    overlayInput = buildEditorialOverlaySvg(overlayParams)
  }

  const layers = [{ input: overlayInput, top: 0, left: 0 }]
  if (logoUrl) {
    const logoLayer = await buildLogoCompositeLayer(logoUrl, width, height)
    if (logoLayer) layers.push(logoLayer)
  }

  const out = await sharp(photoLayer)
    .composite(layers)
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()

  return { buffer: out, width, height }
}

/**
 * Plain ad-size render: subject-aware crop to an ad aspect + gentle brand grade,
 * with NO editorial overlay. Used by the ad-export pack so a Library photo
 * becomes a clean, correctly-sized ad image. When you want baked headline/accent
 * furniture (an already-composed editorial piece), call renderEditorialPhoto /
 * renderWhoopPhoto with a full treatment instead.
 *
 * @param {{ photoUrl: string, aspect?: string, grade?: number }} params
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function renderAdPhoto({ photoUrl, aspect, grade }) {
  const [width, height] = EDITORIAL_ASPECTS[aspect] || EDITORIAL_ASPECTS['1:1']

  const buffer = await fetchSourcePhotoBuffer(photoUrl)

  // Same gentle, on-brand grade as the editorial path (default 40).
  const g = Math.min(Math.max(Number(grade ?? 40), 0), 100) / 100
  const out = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize(width, height, { fit: 'cover', position: 'attention' }) // subject-aware crop
    .modulate({ brightness: 1 + g * 0.12, saturation: 1 + g * 0.18 })
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()

  return { buffer: out, width, height }
}

// Helper to convert a Web ReadableStream → Node Readable (for streamed
// uploads to Blob if we ever need to switch from Buffer to stream).
export function bufferToNodeStream(buffer) {
  return Readable.from(buffer)
}
