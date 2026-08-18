import { Plus, X, Lock, Play } from 'lucide-react'
import { photoSourceUrl, slideMediaEntry, isVideoEntry } from '@/lib/mediaEntry'

// ── Slide picker strip (floats directly under the preview photo — no bar,
// no label row, no card background; reads as part of the canvas). Each
// thumbnail carries its own hover-delete (X) so add/remove both happen right
// where you pick a slide, instead of being buried in the Slide tool's
// inspector panel. Mockup-approved: .claude/mockups/slide-picker-artifact.html
//
// `mediaUrls` is the RAW media_urls array, not the photo-only filtered list.
// That matters: a video is absent from the filtered list entirely, so a strip
// fed the filtered array can't render a video slide at all. slideMediaEntry
// resolves media_idx (raw) first and falls back to photo_idx (filtered) for
// legacy rows, so passing raw is correct for both.

// One slide thumb. A video slide is a locked card — poster + play badge +
// duration — because trim/captions/music live in the video editor, not here
// (mockup rev 2, screen 3). Photo slides are unchanged.
function SlideThumb({ entry, idx, isActive, hasTemplate, onSelect }) {
  const video = isVideoEntry(entry)
  const thumb = entry ? (entry.thumbnailUrl || (video ? null : photoSourceUrl(entry))) : null
  const secs = Number(entry?.duration_s)

  return (
    <button
      type="button"
      onClick={() => onSelect(idx)}
      aria-label={`Slide ${idx + 1}${video ? ' (video)' : ''}`}
      className={`relative aspect-[4/5] h-14 overflow-hidden rounded-md border transition-all ${
        isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'
      }`}
    >
      {thumb
        ? <img src={thumb} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
        : <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-500" />
      }
      <div className="pointer-events-none absolute inset-0 bg-black/15" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-3xs font-semibold leading-tight text-white">{idx + 1}</span>
      {hasTemplate && !video && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(var(--action))' }} />
      )}
      {video && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 bg-black/60 py-0.5 text-3xs font-semibold text-white">
          <Play className="h-2 w-2 fill-current" aria-hidden="true" />
          {Number.isFinite(secs) && secs > 0 ? `${Math.round(secs)}s` : 'Video'}
        </span>
      )}
    </button>
  )
}

export default function SlidePickerStrip({ slides, activeIdx, mediaUrls, onSelect, onAdd, onRemove, canAdd = true }) {
  return (
    <div className="mt-3 flex shrink-0 items-center gap-1.5 overflow-x-auto">
      {slides.map((slide, idx) => (
        <div key={idx} className="group relative shrink-0">
          <SlideThumb
            entry={slideMediaEntry(slide, mediaUrls)}
            idx={idx}
            isActive={idx === activeIdx}
            hasTemplate={!!slide.template_id}
            onSelect={onSelect}
          />
          {slides.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(idx) }}
              aria-label={`Delete slide ${idx + 1}`}
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:text-destructive group-hover:flex"
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {canAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="flex h-14 w-[45px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="flex h-14 w-[120px] shrink-0 items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-1.5 text-center text-3xs leading-snug text-muted-foreground/70">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Locked to 1 photo</span>
        </div>
      )}
    </div>
  )
}
