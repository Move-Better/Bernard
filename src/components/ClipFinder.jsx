import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Scissors, Check, X, AlertCircle, Film, Play, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { findClips, getSegments, updateSegment, renderSegments } from '@/lib/clipsLib'

// Multi-clip video v1. Embedded in the MediaDetail drawer for video sources:
// "Find clips" transcribes the source and proposes standalone ≤60s moments; the
// clinician taps a clip's thumbnail to preview that exact window in the source
// video (seeks to start_sec, auto-pauses at end_sec), then keeps or discards.
// Kept segments render into media_assets b-roll clips (parent_asset_id = source).
// Clips land in the Library and bump the source's "clips cut" count on the Slate.

function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const POLL_INTERVAL_MS = 3000
// Hard cap so a hard-killed detection (segmentDetect.js hitting the 300s wall)
// can't keep the drawer polling indefinitely. Mirrors Book.jsx's cap.
const POLL_CAP_MS = 5 * 60 * 1000

// One inline video player shared across all proposals for a given source asset.
// Re-seeks to the active clip window whenever activeClip changes.
function ClipPreviewPlayer({ blobUrl, thumbnailUrl, activeClip, onClose }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const el = videoRef.current
    if (!el || !activeClip) return
    el.currentTime = activeClip.startSec
    el.play().catch(() => {})
    function onTimeUpdate() {
      if (el.currentTime >= activeClip.endSec) el.pause()
    }
    el.addEventListener('timeupdate', onTimeUpdate)
    return () => el.removeEventListener('timeupdate', onTimeUpdate)
  }, [activeClip])

  if (!activeClip) return null

  const dur = Math.round(activeClip.endSec - activeClip.startSec)
  // Aspect ratio from the asset if available; fall back to 16:9 for landscape,
  // 9:16 for portrait based on the thumbnail dimensions (runtime measure).
  // The <video> uses object-contain so any aspect mismatch just letterboxes.

  return (
    <div className="px-3 pb-3 space-y-1.5">
      <div
        className="rounded-lg overflow-hidden bg-black w-full"
        style={{ maxHeight: '320px', aspectRatio: activeClip.aspectRatio || '16 / 9' }}
      >
        <video
          ref={videoRef}
          src={blobUrl}
          poster={thumbnailUrl || undefined}
          className="w-full h-full object-contain"
          controls
          playsInline
          preload="metadata"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">
          {mmss(activeClip.startSec)}–{mmss(activeClip.endSec)} · {dur}s of source
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-2xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronUp className="h-3 w-3" />Close preview
        </button>
      </div>
    </div>
  )
}

// Individual proposal row with thumbnail play button.
function ProposalRow({ s, asset, isActive, isSelected, canEdit, onTogglePreview, onToggleSelect, onDiscard }) {
  const startSec = Number(s.start_sec) || 0
  const endSec   = Number(s.end_sec) || 0
  const dur = Math.round(endSec - startSec)

  return (
    <li key={s.id} className="border-t">
      {/* Main row */}
      <div className="px-3 py-2 flex items-start gap-2">
        {/* Thumbnail play button — tapping toggles the shared inline player */}
        <button
          type="button"
          onClick={() => onTogglePreview(s)}
          className="shrink-0 relative rounded-md overflow-hidden bg-muted mt-0.5 group"
          style={{ width: 64, height: 64 }}
          title={`Preview: ${mmss(startSec)}–${mmss(endSec)}`}
          aria-pressed={isActive}
        >
          {asset.thumbnail_url ? (
            <img
              src={asset.thumbnail_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-slate-800" />
          )}
          {/* Overlay: Play icon, or an "active" indicator when this clip is showing */}
          <div className={`absolute inset-0 flex items-center justify-center transition-colors ${
            isActive
              ? 'bg-primary/30'
              : 'bg-black/40 group-hover:bg-black/20'
          }`}>
            {isActive ? (
              <div className="h-6 w-6 rounded-full bg-primary/80 flex items-center justify-center">
                <ChevronUp className="h-3.5 w-3.5 text-white" />
              </div>
            ) : (
              <div className="h-6 w-6 rounded-full bg-black/50 flex items-center justify-center">
                <Play className="h-3 w-3 text-white ml-0.5" />
              </div>
            )}
          </div>
        </button>

        <div className="min-w-0 flex-1 text-xs">
          <div className="font-medium leading-snug" title={s.hook}>
            {s.hook || 'Untitled clip'}
          </div>
          <div className="text-2xs text-muted-foreground mt-0.5">
            {mmss(startSec)}–{mmss(endSec)} · {dur}s
          </div>
          {s.why_it_stands_alone && (
            <div className="text-2xs text-muted-foreground mt-0.5 leading-snug">
              {s.why_it_stands_alone}
            </div>
          )}
          {s.transcript_excerpt && (
            <details className="mt-1">
              <summary className="text-3xs text-muted-foreground cursor-pointer hover:text-foreground">
                Transcript
              </summary>
              <p className="text-2xs text-foreground mt-0.5 whitespace-pre-wrap">
                {s.transcript_excerpt}
              </p>
            </details>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {canEdit && (
            <>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(s.id)}
                className="h-3.5 w-3.5 accent-primary"
                aria-label="Include when creating clips"
              />
              <button
                type="button"
                onClick={() => onDiscard(s.id)}
                aria-label="Discard this suggestion"
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-destructive transition-colors"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Inline preview player — only for the active clip */}
      {isActive && (
        <ClipPreviewPlayer
          blobUrl={asset.blob_url}
          thumbnailUrl={asset.thumbnail_url}
          activeClip={{ startSec, endSec, aspectRatio: aspectRatioFor(asset) }}
          onClose={() => onTogglePreview(s)}
        />
      )}
    </li>
  )
}

// Derive a CSS aspect-ratio string from the asset's stored dims.
// Falls back to 16/9 (safe for any unknown source).
function aspectRatioFor(asset) {
  const w = asset.width, h = asset.height
  if (w && h) return `${w} / ${h}`
  return '16 / 9'
}

export default function ClipFinder({ asset, canEdit }) {
  const assetId = asset.id
  const [finding, setFinding] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  // activePreviewId: which proposal's inline player is open (null = none).
  const [activePreviewId, setActivePreviewId] = useState(null)
  // Track which detection batch we've already seeded the default selection for,
  // so a poll round-trip doesn't re-check boxes the user just unchecked.
  const seededRef = useRef(null)
  // Track when polling began so we can cap it — see POLL_CAP_MS above.
  const pollStartRef = useRef({ at: 0 })

  const { data, refetch, isLoading } = useQuery({
    queryKey: ['video-segments', assetId],
    queryFn: () => getSegments(assetId),
    // Poll while detection runs OR any segment is still rendering into a clip;
    // stop once everything settles, or after the hard cap.
    refetchInterval: (q) => {
      const d = q.state.data
      const detecting = d?.status === 'detecting'
      const renderingNow = (d?.segments || []).some((s) => s.status === 'rendering')
      if (!detecting && !renderingNow) return false
      if (!pollStartRef.current.at) pollStartRef.current.at = Date.now()
      if (Date.now() - pollStartRef.current.at > POLL_CAP_MS) return false
      return POLL_INTERVAL_MS
    },
    refetchOnWindowFocus: false,
  })

  const status = data?.status || null
  const note = data?.error || null
  const segments = data?.segments || []
  const proposed = segments.filter((s) => s.status === 'proposed')
  const renderingSegs = segments.filter((s) => s.status === 'rendering')
  const rendered = segments.filter((s) => s.status === 'rendered')

  // Reset the poll cap whenever both detection and rendering are idle, so a
  // later re-run (detect or create-clips) gets a fresh capped window.
  useEffect(() => {
    if (status !== 'detecting' && renderingSegs.length === 0) pollStartRef.current = { at: 0 }
  }, [status, renderingSegs.length])

  // Default-select every proposed segment when a fresh detection batch lands.
  useEffect(() => {
    if (status === 'ready' && seededRef.current !== data?.detectedAt) {
      seededRef.current = data?.detectedAt
      setSelected(new Set(proposed.map((s) => s.id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, data?.detectedAt, proposed.length])

  // Close the preview when proposals change (e.g. after re-detect).
  useEffect(() => { setActivePreviewId(null) }, [data?.detectedAt])

  async function handleFind() {
    setFinding(true)
    setActivePreviewId(null)
    pollStartRef.current = { at: Date.now() }
    try {
      await findClips(assetId)
      toast('Finding clips… transcribing the source — this can take a few minutes.')
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not start clip detection.')
    } finally {
      setFinding(false)
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePreview(s) {
    setActivePreviewId((prev) => prev === s.id ? null : s.id)
  }

  async function handleDiscard(id) {
    if (activePreviewId === id) setActivePreviewId(null)
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    try {
      await updateSegment(id, 'discarded')
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not discard segment.')
    }
  }

  async function handleCreate() {
    const ids = [...selected]
    if (!ids.length) return
    setRendering(true)
    setActivePreviewId(null)
    try {
      const res = await renderSegments(ids)
      const n = res?.clips?.length || 0
      toast(n > 0
        ? `Rendering ${n} clip${n !== 1 ? 's' : ''} — they'll land in your Library when ready.`
        : 'No clips were queued.')
      setSelected(new Set())
      refetch()
    } catch (e) {
      toast.error(e?.message || 'Could not create clips.')
    } finally {
      setRendering(false)
    }
  }

  const detecting = status === 'detecting'
  const failed = status === 'failed'

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="text-xs font-medium flex items-center gap-1.5">
            <Scissors className="h-3.5 w-3.5 text-primary" />
            Clips from this video
            {proposed.length > 0 && (
              <Badge variant="secondary" className="text-3xs">{proposed.length}</Badge>
            )}
          </div>
          <div className="text-2xs text-muted-foreground">
            Tap a clip to preview it in the source — keep or discard before creating.
          </div>
        </div>
        {canEdit && (
          <Button
            size="sm" variant="outline" onClick={handleFind}
            disabled={finding || detecting}
            className="h-7 gap-1.5 text-2xs"
            title="Transcribe this video and propose standalone clip moments"
            aria-label="Transcribe this video and propose standalone clip moments"
          >
            {(finding || detecting)
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Scissors className="h-3.5 w-3.5" />}
            {proposed.length || rendered.length ? 'Find clips again' : 'Find clips'}
          </Button>
        )}
      </div>

      {/* Detecting */}
      {detecting && (
        <div className="flex items-center gap-2 text-2xs text-muted-foreground bg-muted/40 rounded px-2.5 py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Transcribing + finding standalone moments… you can close this drawer; it keeps running.
        </div>
      )}

      {/* Failed */}
      {failed && (
        <div className="flex items-start gap-2 text-2xs text-destructive bg-destructive/10 rounded px-2.5 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{note || 'Clip detection failed.'} {canEdit && 'Try "Find clips" again.'}</span>
        </div>
      )}

      {/* Non-fatal note on success (e.g. long-source truncation) */}
      {status === 'ready' && note && (
        <div className="text-3xs text-muted-foreground">{note}</div>
      )}

      {/* Empty-ready */}
      {status === 'ready' && proposed.length === 0 && renderingSegs.length === 0 && rendered.length === 0 && (
        <div className="text-2xs text-muted-foreground bg-muted/40 rounded px-2.5 py-2">
          No standalone moments stood out in this source. Try a longer or more content-rich recording.
        </div>
      )}

      {/* Proposed segments — thumbnail preview + keep/discard */}
      {proposed.length > 0 && (
        <ul className="divide-y -mx-3 border-t">
          {proposed.map((s) => (
            <ProposalRow
              key={s.id}
              s={s}
              asset={asset}
              isActive={activePreviewId === s.id}
              isSelected={selected.has(s.id)}
              canEdit={canEdit}
              onTogglePreview={togglePreview}
              onToggleSelect={toggle}
              onDiscard={handleDiscard}
            />
          ))}
        </ul>
      )}

      {/* Create clips action */}
      {canEdit && proposed.length > 0 && (
        <div className="flex justify-end pt-1">
          <Button
            size="sm" onClick={handleCreate}
            disabled={rendering || selected.size === 0}
            className="h-7 gap-1.5 text-2xs"
          >
            {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
            Create {selected.size || ''} clip{selected.size === 1 ? '' : 's'}
          </Button>
        </div>
      )}

      {/* Rendering segments — clips in flight (off the request path) */}
      {renderingSegs.length > 0 && (
        <div className="pt-1">
          <div className="text-3xs uppercase tracking-wide font-medium text-muted-foreground mb-1">
            Rendering ({renderingSegs.length})
          </div>
          <ul className="space-y-1">
            {renderingSegs.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                <span className="truncate" title={s.hook}>{s.hook || 'Clip'}</span>
                <span className="text-3xs">· {mmss(s.start_sec)}–{mmss(s.end_sec)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rendered segments — saved as Library b-roll clips */}
      {rendered.length > 0 && (
        <div className="pt-1">
          <div className="text-3xs uppercase tracking-wide font-medium text-muted-foreground mb-1">
            Created clips ({rendered.length})
          </div>
          <ul className="space-y-1">
            {rendered.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Check className="h-3 w-3 text-success shrink-0" />
                <span className="truncate" title={s.hook}>{s.hook || 'Clip'}</span>
                <span className="text-3xs">· {mmss(s.start_sec)}–{mmss(s.end_sec)}</span>
              </li>
            ))}
          </ul>
          <a href="/library" className="text-2xs text-primary underline underline-offset-2 hover:opacity-80 inline-block mt-1">
            View clips in Library →
          </a>
        </div>
      )}

      {isLoading && !data && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}
