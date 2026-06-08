// Shared helpers for mirror-on-publish: walk a blog post's markdown body and
// its attached media_urls to produce a normalized manifest that the WordPress
// and Astro publish handlers can use to copy images out of Bernard blob
// storage and onto the receiving site.
//
// Two image sources feed the manifest:
//   1. Inline references in the markdown body — `![alt](url)` matches.
//   2. The `media_urls` array on the content_items row (image entries only).
//
// The hero image is always media_urls[0] when it's an image (videos skipped).
// Inline body images are emitted as a deduped, ordered list with stable
// per-post filenames so the receiving side can commit them without collisions.
//
// Filename scheme: `<slug>-<idx>.<ext>` where idx starts at 1. The hero is
// emitted separately and not numbered. Receivers should treat `images[*].url`
// as the canonical key to rewrite in markdown.

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// Recognize Bernard-served blob URLs so we don't try to mirror images that
// already live on a public CDN (e.g. unsplash hero stock). Anything we can't
// fetch reliably is left as a hotlink.
function isMirrorableUrl(url) {
  if (typeof url !== 'string' || !url) return false
  if (!/^https?:\/\//i.test(url)) return false
  return (
    /\.public\.blob\.vercel-storage\.com/i.test(url) ||
    /\.blob\.vercel-storage\.com/i.test(url) ||
    /\.bernard\.ai\//i.test(url)
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

// Pull image refs out of markdown in source order, alt text included.
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

// Hero pick: first image entry in media_urls. Falls back to null when only
// videos are attached. Returns the alt from the entry (or filename stem) so
// downstream WP / Astro can set alt_text on the media row.
//
// URL precedence (per the 2026-05-20 hybrid-storage decision):
//   web_blob_url (resized variant — what should land on the public site)
//   → blob_url (canonical, already the web variant for post-PR1 uploads)
//   → rendered_url (legacy compositing output)
// `originalBlobUrl` is never surfaced here — originals stay private to the
// Library; the publish side only ever ships the web variant.
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

// Hero VIDEO pick — the symmetric helper for Mux-transcoded video heroes.
// Returns { playbackId, type: 'mux', alt } so the receiver renders
// <mux-player playback-id="…"> instead of an <img>. Falls back to null when
// no transcoded video is present (we don't surface non-Mux videos as a
// hero — without HLS they don't play reliably cross-browser).
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

// Build the full per-publish image manifest. `slug` seeds deterministic
// filenames so retries don't fan-out duplicate uploads on the receiver.
//
// Output shape (extended 2026-05-20 for the hybrid storage rollout):
//   heroImage     — chosen via pickHero (web_url > web_blob_url > url > …)
//   heroImageAlt  — alt from the matching media_urls entry
//   heroVideo     — { playbackId, type: 'mux', alt, policy } when an
//                   image hero isn't available but a transcoded video is.
//                   Receivers that understand the field render <mux-player>;
//                   older receivers ignore unknown fields, so the post still
//                   publishes (just without a hero video).
//   images        — inline body image manifest with deterministic filenames
export function buildImagesManifest({ markdown, mediaUrls, slug } = {}) {
  const hero = pickHero(mediaUrls)
  const inline = extractInlineImages(markdown)

  // Skip an inline reference that already matches the hero URL — receivers
  // would otherwise upload the same bytes twice.
  const heroUrl = hero?.url
  const bodyImages = inline.filter((img) => img.url !== heroUrl)

  const images = bodyImages.map((img, idx) => ({
    url:      img.url,
    alt:      img.alt,
    filename: defaultFilename(slug, idx + 1, img.url),
    mirrorable: isMirrorableUrl(img.url),
  }))

  // Only emit heroVideo when there isn't an image hero — receivers can only
  // render one hero slot, and an image is the safer choice when both are
  // available (older receivers + RSS reader fallback).
  const heroVideo = hero ? null : pickHeroVideo(mediaUrls)

  return {
    heroImage:    heroUrl || undefined,
    heroImageAlt: hero?.alt || undefined,
    heroVideo:    heroVideo || undefined,
    images,
  }
}

function defaultFilename(slug, idx, url) {
  const safeSlug = String(slug || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'post'
  return `${safeSlug}-${idx}.${extOf(url)}`
}

// Apply a {oldUrl → newUrl} map to inline image references in markdown. Used
// by the WP publisher after uploading each image to /wp/v2/media so the
// emitted HTML points at the WP-hosted copy. Hero images are not referenced
// in the body, so the hero rewrite is a no-op when absent.
export function rewriteMarkdownImageUrls(markdown, urlMap) {
  if (typeof markdown !== 'string' || !markdown) return markdown
  if (!urlMap || typeof urlMap !== 'object') return markdown
  return markdown.replace(MD_IMAGE_RE, (full, alt, url) => {
    const next = urlMap[url]
    if (!next) return full
    return `![${alt || ''}](${next})`
  })
}

export const __test = { MD_IMAGE_RE, isMirrorableUrl, defaultFilename }
