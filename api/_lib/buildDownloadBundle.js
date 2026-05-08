// ZIP bundle builder for content_pieces whose target is a platform without an
// API publish path (reels / feed / story / shorts / tiktok). Streams a ZIP
// with: video.mp4, caption.txt, hashtags.txt, cta.txt — and pipes it straight
// to the response so the function never buffers the whole video in memory.
//
// Caller responsibilities:
//   - load the content_piece + its final media_assets row (final_asset_id)
//   - confirm media_assets.kind === 'video' (callers may also pass image
//     finals for a "story" piece — we just inherit the blob's content type)
//   - mark content_piece status='published' AFTER pipeBundleToResponse
//     resolves; if the stream errors mid-flight the brief stays in 'returned'
//     so the editor can retry.

import archiver from 'archiver'

function safeFilename(s, fallback = 'content') {
  return String(s || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || fallback
}

function captionText(piece) {
  return piece.final_caption || piece.ai_caption || ''
}

function hashtagsText(piece) {
  const tags = Array.isArray(piece.final_hashtags) && piece.final_hashtags.length
    ? piece.final_hashtags
    : (Array.isArray(piece.ai_hashtags) ? piece.ai_hashtags : [])
  // One per line, normalized to a leading '#'. Editors paste this verbatim
  // into IG/TikTok which expect space-or-line-separated tags.
  return tags
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .join('\n')
}

function ctaText(piece) {
  const lines = []
  if (piece.final_cta_text) lines.push(piece.final_cta_text)
  if (piece.final_cta_url)  lines.push(piece.final_cta_url)
  return lines.join('\n')
}

// Pipe a streaming ZIP to res. The caller has already set up auth + loaded
// the piece + asset; this function only handles the streaming archive.
export async function pipeBundleToResponse({ res, piece, finalAsset, brand, dateIso }) {
  if (!finalAsset?.blob_url) {
    throw new Error('Bundle requires a final asset with blob_url')
  }

  const date = (dateIso || new Date().toISOString()).slice(0, 10)
  const platform = piece.target_platform || 'social'
  const slug     = safeFilename(piece.source_quote || piece.id, 'piece')
  const baseName = `${brand}-${platform}-${date}-${slug}`

  // mp4 vs mov etc — preserve the original asset's extension where possible.
  const blobExt  = (finalAsset.blob_pathname || finalAsset.filename || '').split('.').pop().toLowerCase()
  const videoExt = blobExt && blobExt.length <= 4 ? blobExt : 'mp4'
  const videoName = `${baseName}.${videoExt}`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`)

  // Fetch the final-asset blob upstream of the archiver — we want the HTTP
  // error (if any) to surface BEFORE we've written any ZIP bytes, so we can
  // still return a JSON error response. Once we pipe to res we're committed
  // to the stream and any error becomes a partial download.
  const blobRes = await fetch(finalAsset.blob_url)
  if (!blobRes.ok || !blobRes.body) {
    throw new Error(`Final-asset fetch failed: ${blobRes.status}`)
  }

  const archive = archiver('zip', { zlib: { level: 6 } })
  archive.on('warning', (e) => { if (e.code !== 'ENOENT') console.error('[bundle] archiver warning:', e) })
  archive.on('error',   (e) => { console.error('[bundle] archiver error:', e); res.destroy?.(e) })

  archive.pipe(res)

  // Convert WHATWG ReadableStream → Node Readable for archiver.
  // Node 24 exposes Readable.fromWeb on the streams module.
  const { Readable } = await import('node:stream')
  const nodeStream = Readable.fromWeb(blobRes.body)
  archive.append(nodeStream, { name: videoName })

  archive.append(captionText(piece) + '\n',  { name: 'caption.txt' })
  archive.append(hashtagsText(piece) + '\n', { name: 'hashtags.txt' })
  archive.append(ctaText(piece) + '\n',      { name: 'cta.txt' })

  await archive.finalize()
}
