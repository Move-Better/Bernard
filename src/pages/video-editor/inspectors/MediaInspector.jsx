import { InspectorShell } from '../shared'
import MediaPicker from '@/components/MediaPicker'
import SwapAddVideo from '@/components/editor/SwapAddVideo'
import { pickerItemToMediaEntry } from '@/lib/mediaEntry'
import { mediaKindForPlatform } from '@/lib/platformMediaKind'
import { AlertCircle, FolderOpen, Play, Repeat } from 'lucide-react'
import { useState } from 'react'

// ── MEDIA inspector — swap the reel's source video ──────────────────────────
// Embedded (a video content piece) only: a reel has one video, so this REPLACES
// it. The pick is written back through the normal content PATCH (ctx.swapVideo →
// updateItem), which the server reads as a human overriding Bernard's clip
// choice — feeding the media-confidence loop. The piece's new video assetId then
// changes, which remounts the editor (StoryboardPublish keys it on that id) so
// the timeline, transcript and grade re-hydrate cleanly on the new clip.
export function MediaInspector({ ctx }) {
  const { piece, pieceVideoEntry, swapVideo, swapping } = ctx
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false)
  const cur = pieceVideoEntry || null
  const durS = cur?.duration_s
  const dur = Number.isFinite(durS) && durS > 0
    ? `${Math.floor(durS / 60)}:${String(Math.round(durS % 60)).padStart(2, '0')}`
    : null

  // A dual-kind platform (GBP, Facebook, LinkedIn, a regular Instagram post…)
  // can publish a photo OR a video — but a piece opens THIS video editor the
  // moment a clip is attached, and the swap panel above only offers clips, so a
  // user who shot new photos hits a dead end ("video required"). This is the
  // escape hatch: pick a photo and it writes to media_urls, at which point
  // resolveArchetype re-resolves the piece to a 'visual' (no video) and
  // StoryboardPublish routes it back to the full photo editor (SlideEditor).
  // Hidden for video-only platforms (YouTube/TikTok/Reels) and for an explicit
  // reel format, where video is the whole point.
  const allowsPhoto = !!piece?.id
    && mediaKindForPlatform(piece?.platform) !== 'video'
    && piece?.format !== 'reel'

  function handlePhotoPicked(asset) {
    setPhotoPickerOpen(false)
    const list = (Array.isArray(asset) ? asset : [asset]).filter(Boolean)
    // Prefer a photo (the button's promise); a video pick is still a valid swap
    // for a dual-kind post, so fall back to whatever they chose.
    const entries = list.map(pickerItemToMediaEntry)
    const entry = entries.find((e) => e.type === 'image') || entries[0]
    if (entry) swapVideo(entry)
  }

  return (
    <InspectorShell icon={Repeat} title="This reel's video">
      {cur && (
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="relative aspect-[9/16] w-11 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-slate-700 to-slate-900">
            {cur.thumbnailUrl && <img src={cur.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="absolute inset-0 flex items-center justify-center"><Play className="h-4 w-4 text-white/80" fill="currentColor" /></span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{cur.name || 'Current clip'}</p>
            <p className="text-xs text-muted-foreground">{dur ? `${dur} · on this reel` : 'On this reel'}</p>
          </div>
        </div>
      )}

      {piece?.id
        ? <SwapAddVideo pieceId={piece.id} currentAssetId={cur?.mediaAssetId || null} onSwap={swapVideo} swapping={swapping} />
        : <p className="text-sm text-muted-foreground">Open this reel from its post to swap the video.</p>}

      {allowsPhoto && (
        <div className="mt-3 space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-sm font-semibold text-foreground/80">Prefer a photo?</p>
          <p className="text-xs leading-snug text-muted-foreground">
            This post accepts a photo or a video. Switch to a photo and it opens in the photo editor.
          </p>
          <button
            type="button"
            disabled={swapping}
            onClick={() => setPhotoPickerOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/60 bg-primary/5 px-3 py-3 text-sm font-semibold text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Use a photo instead
          </button>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2.5 text-xs leading-snug text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Swapping loads the new clip fresh — trim, captions and grade start over. Your edits stay saved on the old clip if you swap back.
      </p>

      {photoPickerOpen && (
        <MediaPicker onClose={() => setPhotoPickerOpen(false)} onSelect={handlePhotoPicked} />
      )}
    </InspectorShell>
  )
}
