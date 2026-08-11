// Resolve the EDITABLE source for a video asset opened in VideoEditor.
//
// A caption-baked auto-reel is the anomaly this exists for. reelFactory bakes the
// karaoke captions (and, historically, a hook card) into the clip pixels, and the
// content_item's media entry points mediaAssetId at that BAKED clip. But the editor
// assumes mediaAssetId is a RAW, un-captioned source (it draws a live caption
// preview and re-bakes captions on save). Editing the baked blob directly therefore
// double-draws captions in the preview and double-BAKES a second track on save —
// the "double karaoke" a clinician reported (feedback 2a1e68c0, 2026-08-10).
//
// The server resolves the raw source + this clip's source-relative window as
// asset.source_clip (via video_segments.rendered_asset_id — see api/_routes/media/[id].js
// ?withSourceClip=1). When present, edit from the raw source: play/transcribe/render
// it windowed to [startSec,endSec], so captions apply exactly once. A manual clip or
// raw upload has no source_clip and edits from its own blob, exactly as before.
export function resolveVideoEditSource(asset, fallbackAssetId) {
  const sc = asset?.source_clip || null
  const hasWindow = sc && Number.isFinite(sc.startSec) && Number.isFinite(sc.endSec) && sc.endSec > sc.startSec
  return {
    // The <video> src, the transcript sliced for captions, and the render target.
    videoUrl: sc?.blobUrl || asset?.blob_url || null,
    transcriptWords: sc?.transcriptWords || asset?.transcript_words || null,
    assetId: sc?.assetId || fallbackAssetId,
    // Source-relative trim window for a baked reel; null for a normal clip.
    window: hasWindow ? { startSec: sc.startSec, endSec: sc.endSec } : null,
  }
}

// Decide whether the draft's stored trim should be REPLACED by the source window.
// A baked reel's draft trim is CLIP-relative (0..N) from when the entry pointed at
// the baked clip, so it must be replaced with the true source window or the raw
// <video> would play/render the wrong region (the interview's start, not the
// moment). A genuine source-relative re-trim (start >= the window start) is kept.
export function shouldUseSourceWindow(draftStartSec, srcWindow) {
  if (!srcWindow) return false
  return draftStartSec == null || draftStartSec < srcWindow.startSec
}
