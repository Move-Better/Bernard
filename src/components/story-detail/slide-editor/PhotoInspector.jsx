import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Image as ImageIcon, ImagePlus, Repeat, X, Lock, Wand2, Sparkles, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { GRADE_SLIDERS, GRADE_VIBES, NEUTRAL_GRADE, normalizeGrade, isNeutralGrade } from '@/lib/gradeParams'
import SwapAddPhoto from './SwapAddPhoto'
import { autoGradeFromImage } from './imageSampling'

// ── PHOTO inspector body — swap/add + bind + reframe + colorist ──────────────

export default function PhotoInspector({ slide, photoUrl, mediaUrls, pieceId, attachedKeys, onAttachPhoto, onChange, singleSlide = false }) {
  // One photo control: the slide's current photo + Replace, or an empty state
  // that prompts a pick. Picking ALWAYS attaches+binds in one step (per-slide
  // model) — the old "use an attached photo" pool dropdown is gone. `replacing`
  // reveals the picker over an existing photo; reset when the active slide changes.
  const [replacing, setReplacing] = useState(false)
  useEffect(() => { setReplacing(false) }, [photoUrl])
  const [vibePrompt, setVibePrompt] = useState('')
  const [proposing, setProposing] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)

  const hasPhoto = !!photoUrl
  const photoThumb = (typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]?.thumbnailUrl) || photoUrl

  const grade = slide.grade || NEUTRAL_GRADE
  const graded = !isNeutralGrade(grade)
  function setGradeParam(key, value) {
    onChange({ ...slide, grade: normalizeGrade({ ...grade, [key]: Number(value) }) })
  }
  function applyVibe(params) {
    onChange({ ...slide, grade: normalizeGrade(params) })
  }
  function resetGrade() {
    const s = { ...slide }; delete s.grade; onChange(s)
  }
  async function runAutoAdjust() {
    if (autoBusy || !photoUrl) return
    setAutoBusy(true)
    try {
      const g = await autoGradeFromImage(photoUrl)
      onChange({ ...slide, grade: normalizeGrade(g) })
      toast.success('Auto-adjusted — fine-tune below')
    } finally {
      setAutoBusy(false)
    }
  }
  function removePhoto() {
    const s = { ...slide }; s.photo_idx = null; onChange(s)
  }
  async function proposeFromText() {
    const prompt = vibePrompt.trim()
    if (!prompt || proposing) return
    setProposing(true)
    try {
      const res = await apiFetch('/api/editorial/propose-grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      if (res?.params) {
        onChange({ ...slide, grade: normalizeGrade(res.params) })
        toast.success('Look applied — fine-tune below')
      } else {
        toast.error('Could not read a look from that')
      }
    } catch (err) {
      toast.error('Describe-a-look failed', { description: err?.message })
    } finally {
      setProposing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5" style={{ background: 'hsl(var(--primary)/.08)' }}>
        <ImageIcon className="h-6 w-6 text-primary" />
        <span className="text-lg font-bold text-primary">This slide&apos;s photo</span>
      </div>

      {singleSlide && (
        <p className="flex items-start gap-2 rounded-xl border border-dashed border-muted-foreground/30 px-3 py-2.5 text-sm leading-snug text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          This platform supports one photo — picking a new one replaces this one.
        </p>
      )}

      {/* The slide's photo — the photo IS the control: click it to open the
          picker (replace), the corner ✕ removes it. Picking attaches+binds in
          one step (per-slide model). Empty state prompts the first pick. */}
      {hasPhoto ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setReplacing((o) => !o)}
            className={`group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl border-2 transition-colors ${
              replacing ? 'border-primary' : 'border-border hover:border-primary'
            }`}
            aria-label="Replace this photo"
          >
            <img src={photoUrl || photoThumb} alt="Photo on this slide" className="absolute inset-0 h-full w-full object-cover" />
            <span className={`absolute inset-0 flex items-center justify-center gap-2 text-base font-semibold text-white transition-opacity ${replacing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} style={{ background: 'rgba(12,17,29,.42)' }}>
              <Repeat className="h-5 w-5" />
              {replacing ? 'Choose below…' : 'Click to replace'}
            </span>
            {graded && (
              <span className="absolute bottom-2.5 left-2.5 rounded-md bg-primary/90 px-2 py-0.5 text-xs font-semibold text-primary-foreground">Graded</span>
            )}
          </button>
          <button
            type="button"
            onClick={removePhoto}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-destructive"
            style={{ background: 'rgba(12,17,29,.55)' }}
            title="Remove photo"
            aria-label="Remove photo"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-primary/50 bg-primary/5 px-4 py-8 text-center">
          <ImagePlus className="mx-auto mb-2 h-8 w-8 text-primary" />
          <p className="text-base font-semibold text-primary">Add a photo to this slide</p>
          <p className="mt-1 text-sm text-muted-foreground">Pick from AI picks, your library, or upload — it lands straight on the slide.</p>
        </div>
      )}

      {/* Picker — AI picks · describe-the-shot · library/upload. Shown over the
          empty state, or behind "Replace" for an existing photo. */}
      {(!hasPhoto || replacing) && (
        <SwapAddPhoto
          pieceId={pieceId}
          attachedKeys={attachedKeys}
          onAttach={onAttachPhoto}
          onCancel={hasPhoto ? () => setReplacing(false) : null}
        />
      )}

      {/* Reframe (zoom + reset). Drag-to-pan happens on the canvas. */}
      {photoUrl && (
        <div className="space-y-2">
          <p className="text-sm font-bold uppercase tracking-wide text-foreground/80">Frame</p>
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min="1"
              max="4"
              step="0.01"
              value={slide.photo_zoom || 1}
              onChange={(e) => onChange({ ...slide, photo_zoom: parseFloat(e.target.value) })}
              className="h-5 flex-1 accent-primary"
              aria-label="Photo zoom"
            />
            {(slide.photo_zoom > 1 || slide.photo_offset) && (
              <button
                type="button"
                onClick={() => { const s = { ...slide }; delete s.photo_zoom; delete s.photo_offset; onChange(s) }}
                className="shrink-0 font-medium text-primary hover:underline"
              >
                reset
              </button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">Slider far-left = whole photo fits (blurred backdrop fills the rest); zoom in to crop. Drag the photo to reposition · scroll to zoom.</p>
        </div>
      )}

      {/* AI Photo Editor — the colorist. Describe a vibe, tap a preset, or fine-
          tune the five essentials. Same param schema as the server bake. */}
      {photoUrl && (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold uppercase tracking-wide text-primary">AI Photo Editor</span>
            {graded && (
              <button type="button" onClick={resetGrade} className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline">
                reset
              </button>
            )}
          </div>

          {/* One-tap auto-adjust — samples the photo, sets a gentle grade */}
          <button
            type="button"
            onClick={runAutoAdjust}
            disabled={autoBusy}
            className="flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-semibold disabled:opacity-60"
            style={{ borderColor: 'hsl(var(--action))', background: 'hsl(var(--action)/0.08)', color: 'hsl(var(--action))' }}
          >
            {autoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Auto-adjust lighting
          </button>

          {/* Describe the look */}
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Describe the grade or look"
              value={vibePrompt}
              onChange={(e) => setVibePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') proposeFromText() }}
              placeholder="Describe a look — e.g. bright, warm, clinical"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary/50"
              disabled={proposing}
            />
            <button
              type="button"
              onClick={proposeFromText}
              disabled={proposing || !vibePrompt.trim()}
              className="shrink-0 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {proposing ? '…' : 'Apply'}
            </button>
          </div>

          {/* One-tap vibes */}
          <div className="flex flex-wrap gap-2">
            {GRADE_VIBES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => applyVibe(v.params)}
                className="rounded-full border border-border px-3.5 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Fine-tune essentials */}
          <div className="space-y-3 pt-1">
            {GRADE_SLIDERS.map((s) => {
              const val = Number(grade[s.key]) || 0
              return (
                <div key={s.key}>
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>{s.label}</span>
                    <span>{val > 0 ? '+' : ''}{val}</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    value={val}
                    onChange={(e) => setGradeParam(s.key, e.target.value)}
                    className="h-5 w-full accent-primary"
                    aria-label={s.label}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">Applies to this photo. The same grade ships in the published post.</p>
        </div>
      )}
    </div>
  )
}
