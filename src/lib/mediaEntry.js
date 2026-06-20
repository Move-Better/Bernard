// Single source of truth for the content_items.media_urls entry shape:
//   { url, type: 'image'|'video', kind, thumbnailUrl, mediaAssetId, name, duration_s? }
//
// Both the suggestion path (searchClips / suggest-media result rows) and the
// manual Library picker (media_assets rows) normalize THROUGH here, so
// PostPreview + the Buffer dispatcher read an identical shape no matter how the
// media was attached. Never store a bare string url — a bare string publishes a
// video as a broken image (memory: content_items.media_urls shape).
//
// Lifted out of MediaSuggestions.jsx / MediaAttachmentPanel.jsx in the
// Storyboard rebuild so the queue page, the focused page, and the manual picker
// all share one definition instead of three drifting copies.

// A searchClips / suggest-media result row → media_urls entry.
export function clipToMediaEntry(clip) {
  const isVideo = clip.kind === 'video'
  const url = clip.blobUrl || clip.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: clip.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: clip.assetId,
    name:         clip.filename || null,
    ...(clip.durationS != null ? { duration_s: clip.durationS } : {}),
  }
}

// A MediaPicker / media_assets row → media_urls entry.
export function pickerItemToMediaEntry(asset) {
  const isVideo = asset.kind === 'video'
  const url     = asset.rendered_url || asset.blob_url || asset.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: asset.thumbnail_url || asset.thumbnailUrl || (isVideo ? null : url),
    mediaAssetId: asset.id,
    name:         asset.filename || asset.name,
    ...(asset.duration_s != null ? { duration_s: asset.duration_s } : {}),
  }
}

// Stable dedup/identity key for a media entry — the asset id when known, else
// the url. Used to dedupe attaches and to filter already-attached candidates.
export function mediaEntryKey(entry) {
  return entry.mediaAssetId || entry.url
}

// The raw photo to draw UNDER live carousel text. For an entry baked via the
// editorial "Bake to image" flow, `url` is a flattened composite (headline burned
// into a navy card, photo hidden) and `sourceUrl` is the original photo — so the
// carousel must use `sourceUrl` or it draws the baked card instead of the photo.
// Raw (un-baked) entries have no sourceUrl, so this is a no-op for them. Mirrors
// what ad export already does (StoryboardPiece.jsx → `sourceUrl || url`).
export function photoSourceUrl(entry) {
  if (!entry) return null
  return entry.sourceUrl || entry.url || null
}

// True when a media_urls entry is a video. Checks both `kind` and `type`
// because the two normalizers above set both, but older rows / other writers
// may carry only one. One predicate so every surface (preview, composer gate,
// publish) agrees on what counts as a video.
export function isVideoEntry(entry) {
  return entry?.kind === 'video' || entry?.type === 'video'
}

// True when an Instagram piece should publish as a Reel rather than a photo
// carousel: it has at least one video attached. Instagram (and Buffer) treat a
// post as EITHER an all-photo carousel OR a single-video Reel — they can't be
// mixed through our publisher — so the presence of any video makes it a Reel.
// (Mixed photo+video carousels are parked in .claude/ideas.md, blocked on
// Buffer.) Shared so the preview, the composer gate, and any reel-specific UI
// make the same call from the same media_urls array.
export function isInstagramReel(mediaUrls) {
  return Array.isArray(mediaUrls) && mediaUrls.some(isVideoEntry)
}

// Single source of truth for "what format is this piece?" — consumed by both the
// page chrome and the preview so they can never disagree (the header used to
// count SOURCE PHOTOS while the editor rendered one card per SLIDE, so "1 media
// attached" sat next to 5 slide cards, and the word Post/Carousel/Reel appeared
// nowhere). Returns { kind, label, count, unit } where count/unit drive a
// human badge like "Instagram Carousel · 5 slides".
//   - reel:     Instagram piece with any video attached
//   - carousel: Instagram piece with 2+ slides (or 2+ photos)
//   - post:     a single image/photo piece
const PLATFORM_LABEL = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn',
  gbp: 'Google Business', tiktok: 'TikTok', instagram_story: 'Instagram Story',
}
export function postFormat(piece) {
  const platform = piece?.platform || ''
  const media = Array.isArray(piece?.media_urls) ? piece.media_urls : []
  const slideCount = Array.isArray(piece?.slides) ? piece.slides.length : 0
  const platformLabel = PLATFORM_LABEL[platform] || (platform ? platform[0].toUpperCase() + platform.slice(1) : '')

  if (platform === 'instagram' && isInstagramReel(media)) {
    return { kind: 'reel', label: `${platformLabel} Reel`, count: 1, unit: 'video' }
  }
  if (platform === 'instagram') {
    // Slides are the output unit; fall back to the source-photo count for fresh
    // drafts that haven't been turned into slides yet.
    const n = slideCount || media.length
    if (n > 1) return { kind: 'carousel', label: `${platformLabel} Carousel`, count: n, unit: 'slides' }
    return { kind: 'post', label: `${platformLabel} Post`, count: n, unit: 'slides' }
  }
  // Non-Instagram: a simple post; count attached media.
  return { kind: 'post', label: platformLabel || 'Post', count: media.length, unit: 'media' }
}
