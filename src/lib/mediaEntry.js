// Single source of truth for the content_items.media_urls entry shape:
//   { url, type: 'image'|'video', kind, thumbnailUrl, mediaAssetId, name,
//     duration_s?,
//     // precut-segment fields (video only) — when present, this entry is a
//     // ≤60s slice of the source video, rendered live at publish via
//     // brandRenderVideo (`-ss start_sec -t (end_sec-start_sec)`):
//     segment_id?, start_sec?, end_sec?, segment_hook? }
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
// When the row is a precut segment (clip.isSegment — see expandVideoSegments in
// api/content-items/suggest-media.js), the start/end offsets and hook ride along
// so publish can render just that slice. The url stays the PARENT source video's
// blob (brandRenderVideo cuts the slice live; there is no separate segment file).
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
    ...(clip.isSegment
      ? {
          segment_id:   clip.segmentId,
          start_sec:    clip.startSec,
          end_sec:      clip.endSec,
          segment_hook: clip.segmentHook || '',
        }
      : {}),
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

// Stable dedup/identity key for a media entry — the segment id when this entry
// is a precut slice, else the asset id, else the url. The segment id matters so
// a segment and its parent whole-video (same mediaAssetId) don't collapse to one
// identity: you can attach both, and an already-attached segment doesn't hide
// its source clip from the candidate list.
export function mediaEntryKey(entry) {
  return entry.segmentId || entry.segment_id || entry.mediaAssetId || entry.url
}
