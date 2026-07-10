import { useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, FolderOpen, Search, Loader2, Upload } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { mediaEntryKey, pickerItemToMediaEntry, clipToMediaEntry } from '@/lib/mediaEntry'
import { useMediaSuggestions } from '@/lib/queries'
import MediaPicker from '@/components/MediaPicker'
import SuggestionThumb from './SuggestionThumb'

// ── SWAP / ADD A PHOTO — the media-attach capability lifted from the choose-
// media screen (StoryboardPiece) INTO the editor's Photo inspector. AI picks +
// describe-the-shot search (both via /api/content-items/suggest-media) and the
// Library/Upload picker (MediaPicker). Selecting any of them ATTACHES the photo
// to media_urls and rebinds the active slide via onAttach. Photos only here —
// the carousel renderer only draws stills (videos publish as Reels).
export default function SwapAddPhoto({ pieceId, attachedKeys, onAttach, onCancel }) {
  const [tab, setTab] = useState('ai')          // 'ai' | 'library'
  const [pickerOpen, setPickerOpen] = useState(false)
  const [attachingKey, setAttachingKey] = useState(null)
  // Describe-the-shot — a manual query into the same suggest-media brain.
  const [shotQ, setShotQ] = useState('')
  const [shotRes, setShotRes] = useState(null)
  const [shotLoading, setShotLoading] = useState(false)

  // AI picks — photos only. Lazily fetched (only when this panel renders).
  const { data: sugg, isLoading: suggLoading, isError: suggError, refetch } =
    useMediaSuggestions(pieceId, { enabled: !!pieceId, kind: 'photo', k: 6 })

  async function attach(entry) {
    const key = mediaEntryKey(entry)
    setAttachingKey(key)
    try {
      // Always call through — onAttach (attachPhoto) dedupes the media_urls add
      // and rebinds THIS slide, so picking an already-attached photo reuses it
      // on the current slide (per-slide model; reuse across slides is allowed).
      await onAttach(entry)
    } finally {
      setAttachingKey(null)
    }
  }

  async function runShotSearch() {
    const q = shotQ.trim()
    if (!q || shotLoading) return
    setShotLoading(true)
    try {
      const resp = await apiFetch('/api/content-items/suggest-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pieceId, query: q, k: 6, kind: 'photo' }),
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
  const autoClips = (sugg?.clips || [])
  const clips = shotRes ?? autoClips

  function handlePicked(asset) {
    setPickerOpen(false)
    const list = (Array.isArray(asset) ? asset : [asset]).filter(Boolean)
    // Photos only — the carousel renderer can't draw video frames.
    const photo = list.map(pickerItemToMediaEntry).find((e) => e.type !== 'video')
    if (!photo) {
      toast.warning('Pick a photo — carousels are photo-only')
      return
    }
    attach(photo)
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
      <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Swap / add a photo</p>
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
              aria-label="Describe the shot"
              value={shotQ}
              onChange={(e) => setShotQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') runShotSearch() }}
              placeholder="Describe the shot…"
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
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : suggError && shotRes == null ? (
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load picks.{' '}
              <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>
            </p>
          ) : clips.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-5 text-center text-sm text-muted-foreground">
              {shotRes != null ? `Nothing matched “${shotQ}”.` : 'No photo picks — browse your library instead.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {clips.slice(0, 6).map((clip) => {
                const key = clip.assetId || clip.blobUrl || clip.url
                return (
                  <SuggestionThumb
                    key={clip.chunkId || key}
                    clip={clip}
                    attached={attachedKeys.has(clip.assetId)}
                    attaching={attachingKey === key}
                    onAttach={() => attach(clipToMediaEntry(clip))}
                  />
                )
              })}
            </div>
          )}
          <p className="text-sm text-muted-foreground">Picks re-rank from your words. Click one to attach &amp; bind it.</p>
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
          <p className="text-sm text-muted-foreground">Search your whole library or upload a new photo.</p>
        </div>
      )}

      {pickerOpen && (
        <MediaPicker onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          cancel — keep current photo
        </button>
      )}
    </div>
  )
}
