import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, FolderOpen, Search, Loader2, Upload, Play } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { clipToMediaEntry, pickerItemToMediaEntry } from '@/lib/mediaEntry'
import { useMediaSuggestions } from '@/lib/queries'
import MediaPicker from '@/components/MediaPicker'

// ── SWAP THE REEL'S VIDEO — the video counterpart to SwapAddPhoto. AI picks +
// describe-the-shot search (both via /api/content-items/suggest-media with
// kind:'video') and the Library/upload picker (MediaPicker). Picking any clip
// calls onSwap with a media_urls entry, which the VideoEditor writes back to the
// piece's media_urls through the normal content PATCH — so the server reads it
// as a human overriding Bernard's clip choice (media_source:'human') and feeds
// the media-confidence learning loop that already exists for photos.
//
// Videos only: the current clip is shown by the parent (MediaInspector); this
// panel is purely the candidate picker. A reel has ONE video, so a pick REPLACES
// it rather than adding to a pool (the photo panel's per-slide model).

function fmtDur(s) {
  if (!Number.isFinite(s) || s <= 0) return null
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

// One video candidate tile — 9:16 poster, play glyph, duration badge. The clip
// already on this reel is marked and not re-selectable.
function VideoTile({ clip, current, swapping, onPick }) {
  const thumb = clip.thumbnailUrl || null
  const dur = fmtDur(clip.durationS)
  return (
    <button
      type="button"
      disabled={swapping || current}
      onClick={onPick}
      aria-label={current ? 'Already on this reel' : 'Use this clip'}
      className={`group relative aspect-[9/16] overflow-hidden rounded-xl border-2 transition-colors ${
        current ? 'cursor-default border-success' : 'border-border hover:border-primary'
      }`}
    >
      {thumb
        ? <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-900" />}
      <span className="absolute inset-0 flex items-center justify-center">
        {swapping
          ? <Loader2 className="h-7 w-7 animate-spin text-white" />
          : <Play className="h-6 w-6 text-white/85" fill="currentColor" />}
      </span>
      {dur && !current && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-3xs font-bold text-white">{dur}</span>
      )}
      {current && (
        <span className="absolute inset-x-0 bottom-0 bg-success py-1 text-center text-3xs font-bold uppercase tracking-wide text-success-foreground">
          On this reel now
        </span>
      )}
    </button>
  )
}

export default function SwapAddVideo({ pieceId, currentAssetId, onSwap, swapping = false }) {
  const [tab, setTab] = useState('ai')          // 'ai' | 'library'
  const [pickerOpen, setPickerOpen] = useState(false)
  // Describe-the-shot — a manual query into the same suggest-media brain.
  const [shotQ, setShotQ] = useState('')
  const [shotRes, setShotRes] = useState(null)
  const [shotLoading, setShotLoading] = useState(false)

  // AI picks — videos only. Lazily fetched (only when this panel renders).
  const { data: sugg, isLoading: suggLoading, isError: suggError, refetch } =
    useMediaSuggestions(pieceId, { enabled: !!pieceId, kind: 'video', k: 6 })

  async function runShotSearch() {
    const q = shotQ.trim()
    if (!q || shotLoading) return
    setShotLoading(true)
    try {
      const resp = await apiFetch('/api/content-items/suggest-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pieceId, query: q, k: 6, kind: 'video' }),
      })
      setShotRes(resp?.clips || [])
    } catch (e) {
      toast.error('Search failed', { description: e?.message })
    } finally {
      setShotLoading(false)
    }
  }
  function clearShot() { setShotRes(null); setShotQ('') }

  // A describe-the-shot search overrides the automatic ranking until cleared.
  const clips = shotRes ?? (sugg?.clips || [])

  function handlePicked(asset) {
    setPickerOpen(false)
    const list = (Array.isArray(asset) ? asset : [asset]).filter(Boolean)
    // Videos only — a reel needs a clip, not a still.
    const video = list.map(pickerItemToMediaEntry).find((e) => e.type === 'video')
    if (!video) {
      toast.warning('Pick a video — this is the reel’s clip')
      return
    }
    onSwap(video)
  }

  const tabBtn = (k, label, Icon) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
        tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="h-4 w-4" />{label}
    </button>
  )

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Swap the video</p>
      <div className="flex gap-1.5 rounded-xl border border-border p-1">
        {tabBtn('ai', 'AI picks', Sparkles)}
        {tabBtn('library', 'Library', FolderOpen)}
      </div>

      {tab === 'ai' ? (
        <div className="space-y-2.5">
          {/* Describe the shot — manual query into the same picks brain */}
          <div className="flex items-center gap-2 rounded-xl border border-input bg-background px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              aria-label="Describe the clip"
              value={shotQ}
              onChange={(e) => setShotQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runShotSearch() }}
              placeholder="Describe the clip…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              disabled={shotLoading}
            />
            {shotRes != null && (
              <button type="button" onClick={clearShot} className="shrink-0 text-xs font-medium text-primary hover:underline">clear</button>
            )}
            {shotLoading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          {suggLoading && shotRes == null ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-[9/16] animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : suggError && shotRes == null ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load picks.{' '}
              <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>
            </p>
          ) : clips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-sm text-muted-foreground">
              {shotRes != null ? `Nothing matched “${shotQ}”.` : 'No clip picks — browse your library instead.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.slice(0, 6).map((clip) => (
                <VideoTile
                  key={clip.chunkId || clip.assetId || clip.blobUrl}
                  clip={clip}
                  current={!!currentAssetId && clip.assetId === currentAssetId}
                  swapping={swapping}
                  onPick={() => onSwap(clipToMediaEntry(clip))}
                />
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">Ranked by relevance, discounted for reuse. Click one to make it this reel&apos;s video.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/60 bg-primary/5 px-3 py-5 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <Upload className="h-4 w-4" />
            Browse library / upload
          </button>
          <p className="text-sm text-muted-foreground">Search your whole library or upload a new clip.</p>
        </div>
      )}

      {pickerOpen && (
        <MediaPicker onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}
    </div>
  )
}
