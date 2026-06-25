import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Loader2, Scissors, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MediaPicker from './MediaPicker'
import AdExportModal from './AdExportModal'
import AdVideoExportModal from './AdVideoExportModal'
import { getMediaAsset } from '@/lib/mediaLib'
import { toast } from '@/lib/toast'

// Server caps a video ad clip at 60s (render-video); warn before they hit it.
const CLIP_MAX = 60

function fmt(s) {
  const t = Math.max(0, Math.floor(Number(s) || 0))
  const m = Math.floor(t / 60)
  const ss = String(t % 60).padStart(2, '0')
  return `${m}:${ss}`
}

/**
 * Trim stage for a freshly-picked raw video. Sets a start/end window (and an
 * optional burn-in caption) before handing off to AdVideoExportModal, which
 * does the per-aspect ffmpeg re-encode. A whole library video has no clip
 * window, so this is where the user defines one without leaving /ads.
 *
 * @param {{ video: any, onBack: () => void, onClose: () => void, onContinue: (clip: any) => void }} props
 */
function VideoTrimStage({ video, onBack, onClose, onContinue }) {
  const vidRef = useRef(null)
  const [duration, setDuration] = useState(Number(video.duration_s) || 0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(() => {
    const d = Number(video.duration_s) || 0
    return d > 0 ? Math.min(d, 30) : 30
  })
  const [caption, setCaption] = useState('')
  const [metaFailed, setMetaFailed] = useState(false)

  // Library videos here are raw iPhone .mov (HEVC) with no transcoded mp4, which
  // Chrome often can't decode — so onLoadedMetadata may never fire. We seed the
  // length from the asset's server-known duration_s (set by ffprobe); when that's
  // also missing AND the browser can't read it, stop the spinner and say so
  // rather than leaving the user on an indefinitely-disabled button.
  useEffect(() => {
    if (duration > 0) return
    const id = setTimeout(() => setMetaFailed((f) => (duration > 0 ? f : true)), 6000)
    return () => clearTimeout(id)
  }, [duration])

  // Seek the preview so the sliders give visual feedback while dragging.
  const seek = useCallback((t) => {
    const v = vidRef.current
    if (v && Number.isFinite(t)) { try { v.currentTime = t } catch { /* metadata not ready */ } }
  }, [])

  function onMeta() {
    const d = vidRef.current?.duration
    if (Number.isFinite(d) && d > 0) {
      setMetaFailed(false)
      setDuration(d)
      setEnd((e) => (e > d || e <= 0 ? Math.min(d, 30) : e))
    }
  }

  const ready = duration > 0
  const clipLen = Math.max(0, end - start)
  const tooLong = clipLen > CLIP_MAX
  const valid = ready && clipLen >= 1 && !tooLong

  function handleStart(v) {
    const next = Math.min(Number(v), end - 1)
    const clamped = Math.max(0, next)
    setStart(clamped)
    seek(clamped)
  }
  function handleEnd(v) {
    const next = Math.max(Number(v), start + 1)
    const clamped = Math.min(duration || next, next)
    setEnd(clamped)
    seek(clamped)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Scissors className="h-4 w-4 text-action" />
          <span className="text-sm font-semibold">Trim clip for ads</span>
          {video?.name && <span className="truncate text-2xs text-muted-foreground">· {video.name}</span>}
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close"><X className="h-4 w-4" aria-hidden="true" /></Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <div className="mx-auto max-w-sm overflow-hidden rounded-lg bg-black">
            <video
              ref={vidRef}
              src={video.url}
              controls
              playsInline
              onLoadedMetadata={onMeta}
              className="h-auto max-h-[40vh] w-full"
            />
          </div>

          {!ready && !metaFailed && (
            <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading video length…
            </p>
          )}
          {!ready && metaFailed && (
            <div className="mt-3 flex gap-1.5 rounded-lg border border-warning bg-warning/10 p-2.5 text-2xs text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span>
                Couldn&rsquo;t read this clip&rsquo;s length in the browser — it may still be processing.
                Try another clip, or trim it in <span className="font-semibold">Moment Miner</span> once it&rsquo;s ready.
              </span>
            </div>
          )}

          {/* Start / End sliders */}
          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground">Start</span>
                <span className="font-mono text-primary">{fmt(start)}</span>
              </div>
              <input
                type="range" min={0} max={duration || 1} step={0.5} value={start}
                disabled={!ready}
                onChange={(e) => handleStart(e.target.value)}
                className="w-full accent-primary disabled:opacity-50"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-2xs">
                <span className="font-semibold uppercase tracking-wide text-muted-foreground">End</span>
                <span className="font-mono text-primary">{fmt(end)}</span>
              </div>
              <input
                type="range" min={0} max={duration || 1} step={0.5} value={end}
                disabled={!ready}
                onChange={(e) => handleEnd(e.target.value)}
                className="w-full accent-primary disabled:opacity-50"
              />
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2 text-2xs">
            <span className="font-medium text-muted-foreground">Clip length</span>
            <span className={`font-mono font-semibold ${tooLong ? 'text-destructive' : 'text-primary'}`}>{fmt(clipLen)}</span>
            {tooLong && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle className="h-3 w-3" /> Max {CLIP_MAX}s per ad clip — shorten it
              </span>
            )}
          </div>

          {/* Optional burn-in caption */}
          <div className="mt-4">
            <label className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Caption (optional — burned into the clip)
            </label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. The 30-second mobility reset"
              maxLength={140}
              className="w-full rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <Button
            className="ml-auto gap-1.5 bg-action text-action-foreground hover:bg-action/90"
            disabled={!valid}
            onClick={() => onContinue({
              assetId: video.mediaAssetId || video.id,
              startSec: start,
              durationSec: clipLen,
              captionText: caption.trim() || undefined,
              title: video.name,
            })}
          >
            Continue to sizes <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * "New ad creative" flow launched from the /ads page. Walks the user from a
 * media pick → the matching export modal without leaving Ads:
 *   - photo → AdExportModal (seeded with the full media_assets row)
 *   - video → trim window → AdVideoExportModal
 * All export modals already save to ad_creatives, so the new creative lands on
 * the /ads grid on next load.
 *
 * @param {{ onClose: () => void }} props
 */
export default function AdCreateFlow({ onClose }) {
  const [stage, setStage] = useState('pick') // pick | loadingPhoto | photo | trim | video
  const [asset, setAsset] = useState(null)
  const [video, setVideo] = useState(null)
  const [clip, setClip] = useState(null)

  async function handlePick(picked) {
    const item = Array.isArray(picked) ? picked[0] : picked
    if (!item) return
    const isVideo = item.type === 'video' || item.kind === 'video'
    if (isVideo) {
      setVideo(item)
      setStage('trim')
      return
    }
    // Photo → load the full asset row so AdExportModal has the original blob URL,
    // filename and title (the slim picker item only carries a display url).
    setStage('loadingPhoto')
    try {
      const full = item.mediaAssetId ? await getMediaAsset(item.mediaAssetId) : null
      setAsset(full || { id: item.id, blob_url: item.url, filename: item.name, display_title: item.name })
      setStage('photo')
    } catch {
      toast.error("Couldn't load that photo")
      setStage('pick')
    }
  }

  if (stage === 'photo' && asset) {
    return <AdExportModal asset={asset} onClose={onClose} />
  }
  if (stage === 'video' && clip) {
    return <AdVideoExportModal clip={clip} onClose={onClose} />
  }
  if (stage === 'trim' && video) {
    return (
      <VideoTrimStage
        video={video}
        onBack={() => setStage('pick')}
        onClose={onClose}
        onContinue={(c) => { setClip(c); setStage('video') }}
      />
    )
  }
  if (stage === 'loadingPhoto') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="flex items-center gap-2 rounded-xl bg-background px-5 py-4 text-sm text-muted-foreground shadow-2xl">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading photo…
        </div>
      </div>
    )
  }
  return <MediaPicker onSelect={handlePick} onClose={onClose} />
}
