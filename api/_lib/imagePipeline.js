// Image pipeline — runs after a Vercel Blob upload completes for any
// image/* media_assets row. Responsibilities:
//
//   1. Download the freshly-uploaded blob to memory (images are small enough
//      to safely fit; videos use the streaming pipeline elsewhere).
//   2. Detect HEIC/HEIF by mime + magic bytes. If sharp can decode it
//      (libvips on Vercel ships with libheif on the Linux base image), the
//      web variant is emitted as JPEG. The original HEIC stays in Blob so
//      Safari users / re-derivation still have it.
//   3. Resize to max 2000px long edge, re-encode JPEG q80 — preserving
//      PNG (with alpha) for sources that came in as PNG. The existing
//      `feedback_wp_hero_image_upload` pattern lives in api/publish/website.js
//      (resize-before-WP-upload); this module is the upstream variant that
//      runs at intake so every downstream consumer reads from the same web
//      variant.
//   3b. Resize to a 400px-wide JPEG thumbnail from the SAME decoded source
//      (sharp .clone() — one download, one decode, two encodes). Closes the
//      loop mediaEntry.js opened: a photo's media_urls thumbnailUrl now
//      defaults to null until a real thumbnail exists (PR #2331) — without
//      this step every future photo would sit at null forever and every
//      small-tile consumer (e.g. /week's Day-view cards, week-summary.js
//      thumbOf, #2318) would keep falling back to the 2000px web variant.
//      Always JPEG regardless of source format — matches the historical
//      backfill convention (scripts/backfill-photo-thumbnails.mjs) and every
//      thumbnail already in media/thumbs/.
//   4. Generate one-sentence alt text via Claude vision through the AI
//      Gateway. Failures here are non-fatal — the row gets a NULL alt_text
//      and the variant still lands.
//   5. Upload both variants to Blob (`media/web/<workspace>/<asset-id>.<ext>`,
//      `media/thumbs/<workspace>/<asset-id>.jpg`) and return the URL sets so
//      the caller can PATCH the media_assets row. A thumbnail failure is
//      non-fatal and never blocks the web variant — same best-effort
//      contract as video poster generation (thumbnail.js).
//
// This module deliberately does NOT touch the DB. The caller (upload
// completion webhook, Drive import, or backfill script) decides how to
// persist the result — keeps the unit boundary clean and testable.

import sharp from 'sharp'
import heicConvert from 'heic-convert'
import { put as blobPut } from '@vercel/blob'
import { generateText } from 'ai'
import { downloadImageCapped } from './imageSource.js'

const MAX_LONG_EDGE = 2000
const JPEG_QUALITY  = 80
const PNG_COMPRESSION = 9
const THUMB_LONG_EDGE   = 400
const THUMB_JPEG_QUALITY = 78
const ALT_MODEL = 'anthropic/claude-sonnet-4-6'
const ALT_MAX_TOKENS = 200

// Soft cap on the bytes the pipeline will buffer in RAM. Phone JPEGs are
// 2–10 MB; brand book / scanned-PDF images can hit 50 MB. Above this we skip
// the resize (the original is already in Blob and the variant write would
// OOM the function), surfacing it as a non-fatal warning. 60 MB chosen to
// give headroom over the typical 25 MB brand-asset ceiling without risking
// the 1024 MB function memory budget when concurrent uploads land.
const MAX_DECODE_BYTES = 60 * 1024 * 1024

const ALT_PROMPT = [
  'Describe this image in one sentence for use as alt text on a clinic website.',
  'Be specific about what is visible — anatomy, activity, setting, equipment.',
  'No camera-direction phrasing like "a photo of" or "an image showing".',
  'No trailing period unless the sentence needs one for clarity.',
  'Keep under 200 characters.',
].join(' ')

// HEIC/HEIF magic-bytes detection. The ISO BMFF "ftyp" box appears in the
// first 12 bytes of every HEIF-family file. Mime alone is unreliable —
// iPhones occasionally send image/jpeg for a HEIC payload when the share
// sheet transcodes lazily, and direct API uploads may have no mime at all.
//
// Spec: ISO/IEC 14496-12 §4.3 (FileTypeBox). Major brands seen in the wild:
//   heic, heix, hevc, hevx — single still
//   mif1, msf1            — sequences (multi-image HEIC)
//   heim, heis, hevm, hevs — collections
//
// Returns true if magic bytes match, regardless of declared mime.
export function isHeicBuffer(buf) {
  if (!buf || buf.length < 12) return false
  // ftyp box: bytes 4..8 are 'ftyp', bytes 8..12 are the major brand.
  if (buf[4] !== 0x66 || buf[5] !== 0x74 || buf[6] !== 0x79 || buf[7] !== 0x70) return false
  const brand = buf.slice(8, 12).toString('ascii')
  return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'hevm', 'hevs'].includes(brand)
}

export function isHeicMime(mime) {
  if (!mime) return false
  const m = String(mime).toLowerCase()
  return m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence'
}

// Decide the web-variant content-type given the source mime and decoded
// metadata. Rules:
//   HEIC/HEIF → JPEG (browser compatibility)
//   PNG       → PNG  (preserve transparency)
//   anything else → JPEG (smaller, fine for photos)
function chooseWebFormat(sourceMime, isHeic) {
  if (isHeic) return { mime: 'image/jpeg', ext: 'jpg' }
  if (sourceMime === 'image/png') return { mime: 'image/png', ext: 'png' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

// Decode the source once. Every variant (web, thumbnail) derives from this
// via .clone() — sharp's own documented pattern for producing several
// outputs from one input without re-reading/re-decoding the source per
// variant. EXIF rotation is applied here so every variant agrees on
// orientation.
export function decodeBase(sourceBytes) {
  return sharp(sourceBytes, { failOn: 'truncated' }).rotate()
}

// Resize + re-encode a clone of the base pipeline. Returns
// { buffer, width, height, mime }. Throws on unrecoverable encode failures —
// callers decide fatal (web variant) vs. non-fatal (thumbnail). Exported so
// tests exercise the real resize path instead of a hand-copied parallel one.
export async function encodeVariant(basePipeline, { longEdge, mime, quality }) {
  const pipeline = basePipeline.clone().resize({
    width:              longEdge,
    height:             longEdge,
    fit:                'inside',
    withoutEnlargement: true,
  })
  const encoded = mime === 'image/png'
    ? pipeline.png({ compressionLevel: PNG_COMPRESSION, palette: true })
    : pipeline.jpeg({ quality, mozjpeg: true, progressive: true })

  const { data, info } = await encoded.toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height, mime }
}

// Generate one-sentence alt text via Claude vision through the AI Gateway.
// Uses generateText with a single user message that mixes the image as a file
// part and the instruction as text. Failures are non-fatal — return null and
// let the caller PATCH the row without alt_text.
async function generateAltText(imageBytes, mime) {
  if (!process.env.AI_GATEWAY_API_KEY) return null
  try {
    const { text } = await generateText({
      model: ALT_MODEL,
      maxOutputTokens: ALT_MAX_TOKENS,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: ALT_PROMPT },
          { type: 'file', data: imageBytes, mediaType: mime },
        ],
      }],
    })
    const trimmed = String(text || '').trim().replace(/^["']|["']$/g, '')
    if (!trimmed) return null
    return trimmed.slice(0, 250)
  } catch (e) {
    console.error('[imagePipeline] alt-text generation failed:', e?.message)
    return null
  }
}

// Build the Blob pathname for the web variant. Sibling to the original under
// a `media/web/<workspace>/` prefix, matching every other blob writer's
// workspace-first namespacing convention (CLAUDE.md "Blob store").
function webPathname(workspaceId, assetId, ext) {
  return `media/web/${workspaceId}/${assetId}.${ext}`
}

// Thumbnail pathname — same workspace-first convention, sibling to the video
// poster path (thumbnail.js's thumbPathname). Always .jpg (see decode/encode
// step above — thumbnails are always JPEG regardless of source format).
function thumbPathname(workspaceId, assetId) {
  return `media/thumbs/${workspaceId}/${assetId}.jpg`
}

// Main entry point. Given a freshly-uploaded asset row's blob URL + id +
// declared mime, run the full pipeline and return the bits the caller needs
// to PATCH the row.
//
// Inputs:
//   assetId          string  — primary key of the media_assets row
//   blobUrl          string  — Vercel Blob URL of the upload (= original)
//   declaredMime     string  — mime as recorded by the upload handshake
//
// Output (on success):
//   {
//     originalBlobUrl: string,    // pass-through of the input blobUrl
//     webBlobUrl:      string,    // new Blob URL for the resized variant
//     webWidth:        number,
//     webHeight:       number,
//     webMime:         string,
//     webSizeBytes:    number,
//     originalSizeBytes: number,
//     altText:         string|null,
//     formatChanged:   boolean,   // true when HEIC→JPEG
//     thumbnailUrl:    string|null,  // null if thumbnail generation failed —
//                                    // non-fatal, never blocks the web variant
//     thumbWidth:      number|null,
//     thumbHeight:     number|null,
//   }
//
// Output (skip / non-fatal):
//   null  — image was too large to decode safely, or the source wasn't an
//           image after all. Caller should leave the row alone.
export async function processImageUpload({ workspaceId, assetId, blobUrl, declaredMime }) {
  if (!workspaceId || !assetId || !blobUrl) {
    throw new Error('processImageUpload: workspaceId + assetId + blobUrl are required')
  }

  // Probe size BEFORE buffering: a HEAD Content-Length check rejects an
  // oversized original up front so a 40 MB+ HEIC never spikes the heap via
  // arrayBuffer() ahead of the cap (CLAUDE.md large-file rule). When the
  // server omits Content-Length the body streams to disk and the cap is
  // enforced on the materialized file.
  const dl = await downloadImageCapped(blobUrl, MAX_DECODE_BYTES)
  if (dl.tooLarge) {
    console.warn(`[imagePipeline] asset ${assetId}: source ${dl.size} bytes exceeds ${MAX_DECODE_BYTES} cap; skipping resize`)
    return null
  }
  const sourceBytes = dl.buffer

  const heic = isHeicMime(declaredMime) || isHeicBuffer(sourceBytes)
  const target = chooseWebFormat(declaredMime, heic)

  // Two-stage decode for HEIC: heic-convert (pure-JS, environment-independent)
  // produces a JPEG buffer, then sharp resizes/re-encodes it. Sharp's libheif
  // binding is unreliable across Vercel's Linux Lambda images and rejects
  // some iPhone Live Photo / iCloud-re-encoded HEIC variants outright. Don't
  // try sharp's HEIC path at all — heic-convert handles every HEIC we've
  // seen in the wild. JPEG/PNG/etc. continue to flow straight into sharp.
  let bytesForSharp = sourceBytes
  if (heic) {
    try {
      const jpegBuffer = await heicConvert({
        buffer: sourceBytes,
        format: 'JPEG',
        quality: 0.92,
      })
      bytesForSharp = Buffer.from(jpegBuffer)
    } catch (e) {
      console.error(`[imagePipeline] asset ${assetId}: heic-convert decode failed:`, e?.message)
      throw e
    }
  }

  const base = decodeBase(bytesForSharp)

  let resized
  try {
    resized = await encodeVariant(base, { longEdge: MAX_LONG_EDGE, mime: target.mime, quality: JPEG_QUALITY })
  } catch (e) {
    console.error(`[imagePipeline] asset ${assetId}: resize failed:`, e?.message)
    throw e
  }

  // Thumbnail is best-effort: a failure here must never fail the (already
  // web-critical) resize above — same non-fatal contract as video poster
  // generation (thumbnail.js). Always JPEG — see thumbPathname.
  let thumb = null
  try {
    thumb = await encodeVariant(base, { longEdge: THUMB_LONG_EDGE, mime: 'image/jpeg', quality: THUMB_JPEG_QUALITY })
  } catch (e) {
    console.error(`[imagePipeline] asset ${assetId}: thumbnail resize failed (non-fatal):`, e?.message)
  }

  const altText = await generateAltText(resized.buffer, resized.mime)

  const uploaded = await blobPut(webPathname(workspaceId, assetId, target.ext), resized.buffer, {
    access:          'public',
    contentType:     resized.mime,
    addRandomSuffix: true,
    allowOverwrite:  false,
  })

  let thumbUploaded = null
  if (thumb) {
    try {
      thumbUploaded = await blobPut(thumbPathname(workspaceId, assetId), thumb.buffer, {
        access:          'public',
        contentType:     'image/jpeg',
        addRandomSuffix: true,
        allowOverwrite:  false,
      })
    } catch (e) {
      console.error(`[imagePipeline] asset ${assetId}: thumbnail upload failed (non-fatal):`, e?.message)
    }
  }

  return {
    originalBlobUrl:   blobUrl,
    webBlobUrl:        uploaded.url,
    webWidth:          resized.width,
    webHeight:         resized.height,
    webMime:           resized.mime,
    webSizeBytes:      resized.buffer.length,
    originalSizeBytes: sourceBytes.length,
    altText,
    formatChanged:     heic,
    thumbnailUrl:      thumbUploaded?.url ?? null,
    thumbWidth:        thumbUploaded ? thumb.width : null,
    thumbHeight:       thumbUploaded ? thumb.height : null,
  }
}
