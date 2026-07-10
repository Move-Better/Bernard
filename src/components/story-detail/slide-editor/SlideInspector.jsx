import { useState } from 'react'
import { ChevronLeft, ChevronRight, X, Plus } from 'lucide-react'
import { resolveTheme, templateFamily } from '@/lib/photoTemplates'
import { BLOCK_ROLES } from '@/lib/overlayTemplates'
import ThemeTile from './ThemeTile'
import { ROLE_META } from './shared'

// ── SLIDE inspector body — layout + theme (nothing else selected) ────────────

export default function SlideInspector({
  slide, slideIdx, totalSlides, photoUrl, brandStyle, allThemes, customThemes, globalThemeId,
  onChange, onApplyThemeToAll, onAddBlock, onMoveLeft, onMoveRight, onRemove,
}) {
  const [addOpen, setAddOpen] = useState(false)
  // Signature of everything (besides the theme) that changes a thumbnail's pixels.
  const thumbSig = `${photoUrl || ''}|${slide.photo_zoom || 1}|${slide.photo_offset ? `${slide.photo_offset.x},${slide.photo_offset.y}` : ''}|${slide.blocks.map((b) => `${b.role}:${b.text}`).join('~')}|${(slide.objects || []).map((o) => `${o.src}:${o.x},${o.y}:${o.scale}`).join('~')}`
  return (
    <div className="space-y-5">
      {/* Slide management — reorder + delete this slide */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={slideIdx === 0}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move slide earlier"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <span className="flex-1 text-center text-sm font-semibold">
          Slide {slideIdx + 1} <span className="font-normal text-muted-foreground">of {totalSlides}</span>
        </span>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={slideIdx === totalSlides - 1}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Move slide later"
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={totalSlides <= 1}
          className="ml-1 rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
          aria-label="Delete slide"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Theme — visual swatch grid with deck inheritance */}
      <div className="space-y-3">
        <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">
          Theme <span className="font-normal normal-case text-muted-foreground/70">· colour &amp; style</span>
        </p>
        <button
          type="button"
          onClick={() => onChange({ ...slide, template_id: null })}
          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors ${
            !slide.template_id
              ? 'border-primary bg-primary/10 text-primary font-semibold'
              : 'border-border bg-muted/20 text-muted-foreground hover:border-primary/40'
          }`}
        >
          <span>Same as deck</span>
          {!slide.template_id && <span className="text-xs">✓ inheriting</span>}
        </button>
        {/* Two families: Photo templates (full-bleed photo + overlay) and Text
            cards (no photo, branded). Family derived via templateFamily. */}
        <p className="pt-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">
          Photo templates <span className="font-normal normal-case text-muted-foreground/60">· full-bleed photo</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'photo').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <p className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">
          Text cards <span className="font-normal normal-case text-muted-foreground/60">· no photo</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          {allThemes.filter((t) => templateFamily(resolveTheme(t.id, customThemes)) === 'text').map((t) => (
            <ThemeTile key={t.id} t={t} slide={slide} photoUrl={photoUrl} brandStyle={brandStyle} customThemes={customThemes} thumbSig={thumbSig} onChange={onChange} />
          ))}
        </div>
        <button
          type="button"
          onClick={() => onApplyThemeToAll(slide.template_id || globalThemeId)}
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Apply this theme to all slides
        </button>
      </div>

      {/* Add text block */}
      <div className="space-y-2">
        <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Text</p>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="w-full rounded-lg border border-dashed border-primary/60 bg-primary/5 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <Plus className="inline h-4 w-4 -mt-0.5 mr-1" />
            Add text block
          </button>
          {addOpen && (
            <div className="absolute left-0 right-0 z-40 mt-1 rounded-lg border bg-popover p-1.5 shadow-lg">
              {BLOCK_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => { onAddBlock(role); setAddOpen(false) }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${ROLE_META[role].chip}`}>
                    {ROLE_META[role].label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Click any layer above, or the photo/text on the canvas, to edit it.
        </p>
      </div>
    </div>
  )
}
