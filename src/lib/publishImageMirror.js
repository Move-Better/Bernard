// Client-side build of the publish image manifest. Mirrors the read-only half
// of api/_lib/publishImageMirror.js — the server owns rewriteMarkdownImageUrls
// since only the WP path runs it. Keep the two files in sync; they share unit
// tests at tests/unit/publishImageMirror.test.js.

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

function isMirrorableUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (!/^https?:\/\//i.test(url)) return false
  return (
    /\.public\.blob\.vercel-storage\.com/i.test(url) ||
    /\.blob\.vercel-storage\.com/i.test(url) ||
    /\.narraterx\.ai\//i.test(url)
  )
}

function extOf(url, fallback = 'jpg') {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() || ''
    const dot = last.lastIndexOf('.')
    if (dot > 0 && dot < last.length - 1) return last.slice(dot + 1).toLowerCase().split('?')[0]
  } catch { /* fall through */ }
  return fallback
}

export function extractInlineImages(markdown) {
  if (typeof markdown !== 'string' || !markdown) return []
  const out = []
  const seen = new Set()
  let m
  MD_IMAGE_RE.lastIndex = 0
  while ((m = MD_IMAGE_RE.exec(markdown)) !== null) {
    const alt = (m[1] || '').trim()
    const url = m[2]
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ alt, url })
  }
  return out
}

// URL precedence post-2026-05-20 hybrid storage:
//   web_url / web_blob_url (resized variant)
//   → url / blob_url (canonical, already the web variant for post-PR1 uploads)
//   → rendered_url (legacy compositing output)
// Originals stay private — never surfaced to the publish payload.
export function pickHero(mediaUrls) {
  if (!Array.isArray(mediaUrls)) return null
  for (const entry of mediaUrls) {
    if (!entry) continue
    const isImage = entry.kind === 'image' || entry.type === 'image' || entry.type === 'photo'
    if (!isImage) continue
    const url = entry.web_url || entry.web_blob_url || entry.url || entry.blob_url || entry.rendered_url
    if (!url) continue
    const alt = entry.alt || entry.name || ''
    return { url, alt }
  }
  return null
}

// Mux-transcoded video hero, mirrors pickHero. Only ready videos with a
// playback_id are eligible — pending/processing/errored never become heroes.
export function pickHeroVideo(mediaUrls) {
  if (!Array.isArray(mediaUrls)) return null
  for (const entry of mediaUrls) {
    if (!entry) continue
    const isVideo = entry.kind === 'video' || entry.type === 'video'
    if (!isVideo) continue
    const playbackId = entry.mux_playback_id || entry.playback_id
    if (!playbackId) continue
    if (entry.transcode_status && entry.transcode_status !== 'ready') continue
    return {
      type:        'mux',
      playbackId,
      alt:         entry.alt || entry.name || '',
      policy:      entry.video_playback_policy || 'signed',
    }
  }
  return null
}

function defaultFilename(slug, idx, url) {
  const safeSlug = String(slug || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'post'
  return `${safeSlug}-${idx}.${extOf(url)}`
}

export function buildImagesManifest({ markdown, mediaUrls, slug } = {}) {
  const hero = pickHero(mediaUrls)
  const inline = extractInlineImages(markdown)
  const heroUrl = hero?.url
  const bodyImages = inline.filter((img) => img.url !== heroUrl)
  const images = bodyImages.map((img, idx) => ({
    url:        img.url,
    alt:        img.alt,
    filename:   defaultFilename(slug, idx + 1, img.url),
    mirrorable: isMirrorableUrl(img.url),
  }))
  // heroVideo only emitted when there's no image hero — receivers can only
  // render one hero slot; older receivers ignore unknown fields cleanly.
  const heroVideo = hero ? null : pickHeroVideo(mediaUrls)
  return {
    heroImage:    heroUrl || undefined,
    heroImageAlt: hero?.alt || undefined,
    heroVideo:    heroVideo || undefined,
    images,
  }
}
