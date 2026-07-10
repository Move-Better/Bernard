import { Plus, X, Lock } from 'lucide-react'
import { photoSourceUrl } from '@/lib/mediaEntry'

// ── Slide picker strip (floats directly under the preview photo — no bar,
// no label row, no card background; reads as part of the canvas). Each
// thumbnail carries its own hover-delete (X) so add/remove both happen right
// where you pick a slide, instead of being buried in the Slide tool's
// inspector panel. Mockup-approved: .claude/mockups/slide-picker-artifact.html

export default function SlidePickerStrip({ slides, activeIdx, mediaUrls, onSelect, onAdd, onRemove, canAdd = true }) {
  return (
    <div className="mt-3 flex shrink-0 items-center gap-1.5 overflow-x-auto">
      {slides.map((slide, idx) => {
        const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
          ? (mediaUrls[slide.photo_idx].thumbnailUrl || photoSourceUrl(mediaUrls[slide.photo_idx]))
          : null
        const isActive = idx === activeIdx
        return (
          <div key={idx} className="group relative shrink-0">
            <button
              type="button"
              onClick={() => onSelect(idx)}
              className={`relative aspect-[4/5] h-14 overflow-hidden rounded-md border transition-all ${
                isActive ? 'border-primary ring-1 ring-primary/40' : 'border-border hover:border-primary/40'
              }`}
            >
              {photoUrl
                ? <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                : <div className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-500" />
              }
              <div className="absolute inset-0 bg-black/15" />
              <span className="absolute left-0.5 top-0.5 rounded bg-black/55 px-1 text-3xs font-semibold leading-tight text-white">{idx + 1}</span>
              {slide.template_id && (
                <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(var(--action))' }} />
              )}
            </button>
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
        )
      })}
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
