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
import { Readable } from 'node:stream'
import { getBrandFont, ensureFontconfig } from './brandFonts.js'

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

  // Fetch source photo into memory. Cap at 50MB to avoid surprise OOMs.
  const response = await fetch(photoUrl)
  if (!response.ok) {
    throw new Error(`Source fetch failed: ${response.status}`)
  }
  // Cheap early-out on the declared size, but Content-Length is often absent on
  // chunked Blob/CDN responses (fresh uploads), so the header check alone lets a
  // huge body through. Enforce the real size after materializing.
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  if (contentLength > 50 * 1024 * 1024) {
    throw new Error(`Source too large: ${contentLength} bytes`)
  }
  const arrayBuf = await response.arrayBuffer()
  if (arrayBuf.byteLength > 50 * 1024 * 1024) {
    throw new Error(`Source too large: ${arrayBuf.byteLength} bytes`)
  }
  const buffer = Buffer.from(arrayBuf)

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
 * Render one editorial composite from a source photo + treatment spec.
 * Applies a subtle grade (brightness/saturation) and a subject-aware ("smart")
 * crop, then composites the editorial overlay.
 *
 * @param {Object} params
 * @param {string} params.photoUrl
 * @param {Object} params.treatment  — { headline, headlineSize, grade (0-100), aspect, scrim }
 * @param {Object} params.workspace
 * @param {string} [params.staffName]
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
export async function renderEditorialPhoto({ photoUrl, treatment = {}, workspace, staffName }) {
  await ensureFontconfig()

  const [width, height] = EDITORIAL_ASPECTS[treatment.aspect] || EDITORIAL_ASPECTS['4:5']

  const response = await fetch(photoUrl)
  if (!response.ok) throw new Error(`Source fetch failed: ${response.status}`)
  // Header check is a cheap early-out; Content-Length is often null on chunked
  // Blob/CDN responses, so re-check the actual byte length post-download.
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
  if (contentLength > 50 * 1024 * 1024) throw new Error(`Source too large: ${contentLength} bytes`)
  const arrayBuf = await response.arrayBuffer()
  if (arrayBuf.byteLength > 50 * 1024 * 1024) throw new Error(`Source too large: ${arrayBuf.byteLength} bytes`)
  const buffer = Buffer.from(arrayBuf)

  // Grade: map 0-100 onto a restrained brightness/saturation lift. The default
  // (40) is a gentle, on-brand normalization, not a heavy filter.
  const g = Math.min(Math.max(Number(treatment.grade ?? 40), 0), 100) / 100

  const photoLayer = await sharp(buffer)
    .rotate() // honor EXIF orientation
    .resize(width, height, { fit: 'cover', position: 'attention' }) // subject-aware crop
    .modulate({ brightness: 1 + g * 0.12, saturation: 1 + g * 0.18 })
    .jpeg({ quality: 90 })
    .toBuffer()

  const { primaryColor, accentColor } = resolveBrandColors(workspace)
  const { buffer: fontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))

  const overlaySvg = buildEditorialOverlaySvg({
    width,
    height,
    headline: treatment.headline || '',
    headlineSize: treatment.headlineSize || 'm',
    staffName,
    workspaceName: workspace?.display_name || '',
    accentColor,
    scrimColor: treatment.scrim === 'brand' ? primaryColor : DEFAULT_SCRIM,
    fontBuffer,
  })

  const out = await sharp(photoLayer)
    .composite([{ input: overlaySvg, top: 0, left: 0 }])
    .jpeg({ quality: 90, progressive: true })
    .toBuffer()

  return { buffer: out, width, height }
}

// Helper to convert a Web ReadableStream → Node Readable (for streamed
// uploads to Blob if we ever need to switch from Buffer to stream).
export function bufferToNodeStream(buffer) {
  return Readable.from(buffer)
}
