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
//
// thumbnailUrl is null, not url, when no real thumbnail exists yet — for
// BOTH kinds. It used to fall back to the full-resolution url for photos
// ("a photo entry's thumbnailUrl is just its own url"), which meant every
// small-tile consumer (e.g. /week's Day-view cards) decoded a multi-MB
// original into a 40-64px box. Consumers that render a thumbnail-sized photo
// already fall back to the real source (`photoSourceUrl(entry) || entry.url`)
// when thumbnailUrl is falsy — see week-summary.js, PhotoInspector.jsx,
// SlidePickerStrip.jsx, DraftContextPanel.jsx — so this is a size hint, not a
// required field; null just means "no thumbnail yet," same as it already does
// for video.
export function clipToMediaEntry(clip) {
  const isVideo = clip.kind === 'video'
  const url = clip.blobUrl || clip.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: clip.thumbnailUrl || null,
    mediaAssetId: clip.assetId,
    name:         clip.filename || null,
    ...(clip.durationS != null ? { duration_s: clip.durationS } : {}),
  }
}

// A MediaPicker / media_assets row → media_urls entry. See clipToMediaEntry's
// header comment — same null-not-url rule applies here.
export function pickerItemToMediaEntry(asset) {
  const isVideo = asset.kind === 'video'
  const url     = asset.rendered_url || asset.blob_url || asset.url
  return {
    url,
    type:         isVideo ? 'video' : 'image',
    kind:         isVideo ? 'video' : 'image',
    thumbnailUrl: asset.thumbnail_url || asset.thumbnailUrl || null,
    mediaAssetId: asset.id,
    name:         asset.filename || asset.name,
    ...(asset.duration_s != null ? { duration_s: asset.duration_s } : {}),
    // Dimensions when the source knows them. Consumed by the carousel fit step
    // to tell a natively-eligible 16:9 master from a 9:16 clip that Instagram
    // would reject in a carousel. Conditional because the suggestion path
    // (clipSearch) does not select these columns — see mayNeedCarouselRebake,
    // which fails open rather than guessing when they're absent.
    ...(Number.isFinite(asset.width) && Number.isFinite(asset.height)
      ? { width: asset.width, height: asset.height }
      : {}),
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

// The photos a carousel can bind text to: non-video media with a URL.
//
// A slide's `photo_idx` indexes THIS FILTERED list, not raw media_urls — that is
// what both writers compute against (SlideEditor's attach + auto-populate) and
// what the publish bake reads. Any surface that resolves a slide's photo from
// the RAW array shows a different photo than the one that ships, the moment a
// video or a url-less entry sits earlier in media_urls.
//
// The predicate is deliberately `type !== 'video'` and NOT isVideoEntry() below:
// widening it to also exclude `kind === 'video'` would renumber the filtered
// list, and every photo_idx already stored on a content_items row is an index
// into the current numbering. Consolidation only — no behavior change.
export function slidePhotos(mediaUrls) {
  return (mediaUrls || []).filter((m) => m && m.type !== 'video' && m.url)
}

// Resolve the media entry a slide is bound to. One resolver so a preview, the
// editor canvas and the publish bake can never disagree about which item a
// slide names.
//
// Two numberings, in precedence order:
//   media_idx — index into RAW media_urls. Written by every current writer;
//               the only one that can address a VIDEO slide, because videos
//               are absent from the filtered list entirely.
//   photo_idx — index into the photo-only filtered list (slidePhotos). The
//               legacy field, still the fallback for rows written before
//               media_idx existed.
//
// Safe to read either way for legacy rows: verified against prod 2026-07-29
// that all 86 slide-bearing pieces have zero video/url-less entries, so their
// filtered list and raw array are identical and the two indexes agree.
export function slideMediaEntry(slide, mediaUrls) {
  const raw = Array.isArray(mediaUrls) ? mediaUrls : []
  if (typeof slide?.media_idx === 'number') return raw[slide.media_idx] || null
  if (typeof slide?.photo_idx !== 'number') return null
  return slidePhotos(raw)[slide.photo_idx] || null
}

// Photo-only resolver — returns null for a slide bound to a VIDEO.
//
// Kept distinct from slideMediaEntry because the photo-drawing surfaces (the
// canvas bake, the ad export, the slide compositor) can only draw a still, and
// silently handing them a video entry publishes a broken image. A caller that
// can render both should use slideMediaEntry + isVideoEntry instead.
export function slidePhotoEntry(slide, mediaUrls) {
  const entry = slideMediaEntry(slide, mediaUrls)
  return entry && !isVideoEntry(entry) ? entry : null
}

// The entry to actually PUBLISH for a video sitting in a 4:5 carousel slot.
//
// A 9:16 clip is below Instagram's 0.8 carousel floor and would be rejected, so
// the editor bakes a 4:5 variant (api/_routes/editorial/fit-carousel-clip.js)
// and records it on the entry as `carouselVariant`. Publishing must send THAT,
// not the master — sending the master means either a rejected post or, with
// bundle's autoFit, a pillarboxed clip nobody chose.
//
// Returns the entry unchanged when there is no variant: a 16:9 master (1.78)
// sits inside the 0.8–1.91 window and is natively eligible, so most landscape
// clips legitimately need nothing.
export function carouselPublishEntry(entry) {
  const v = entry?.carouselVariant
  if (!v?.url) return entry
  return {
    ...entry,
    url: v.url,
    ...(v.thumbnailUrl ? { thumbnailUrl: v.thumbnailUrl } : {}),
    // Keep the MASTER's id: the variant is a rendering of this asset, and
    // dedup/reuse/usage-counting should all still resolve to the one clip.
    sourceUrl: entry.url,
  }
}

// True when a media_urls entry is a video. Checks both `kind` and `type`
// because the two normalizers above set both, but older rows / other writers
// may carry only one. One predicate so every surface (preview, composer gate,
// publish) agrees on what counts as a video.
export function isVideoEntry(entry) {
  return entry?.kind === 'video' || entry?.type === 'video'
}

// LEGACY derivation: an Instagram piece with any video attached publishes as a
// Reel. This is the fallback for pieces with NO explicit content_items.format —
// which is every row written before the format column existed, so it must keep
// behaving exactly as it always has. It is NOT a platform law anymore: mixed
// photo+video carousels are real through bundle.social (carouselItems, verified
// live 2026-07-29), reachable by setting format='carousel' explicitly. Callers
// deciding reel-ness for DISPATCH should check `piece.format === 'reel'` first
// and only fall back here when format is null (see dispatchContentItem.js,
// bundlePublisher.js). Shared so the preview, the composer gate, and any
// reel-specific UI make the same legacy call from the same media_urls array.
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

  // An explicit content_items.format wins over every derivation below — that's
  // the whole point of the column (a video inside a carousel must not relabel
  // the piece a Reel). Null format = legacy derived behavior, unchanged.
  const explicit = typeof piece?.format === 'string' ? piece.format : null
  if (explicit === 'reel') {
    return { kind: 'reel', label: `${platformLabel} Reel`, count: 1, unit: 'video' }
  }
  if (explicit === 'story') {
    return { kind: 'story', label: `${platformLabel} Story`, count: media.length || 1, unit: 'media' }
  }
  if (explicit === 'carousel') {
    const n = slideCount || media.length
    return { kind: 'carousel', label: `${platformLabel} Carousel`, count: n, unit: 'slides' }
  }
  if (explicit === 'post') {
    return { kind: 'post', label: `${platformLabel} Post`, count: media.length, unit: 'media' }
  }

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
