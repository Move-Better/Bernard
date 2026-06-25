import { useEffect, useRef, useState } from 'react'
import {
  X, Loader2, Check, Quote, BarChart3, Megaphone, MousePointerClick,
  PenLine, Palette, Type, Bookmark,
} from 'lucide-react'
import {
  LAYOUTS, LAYOUT_IDS, BACKGROUND_PRESETS, SIZE_OPTIONS, POSITION_OPTIONS,
  defaultTextCardState, renderTextCard, bakeTextCard,
} from '@/lib/textCard'
import { toast } from '@/lib/toast'

const LAYOUT_ICONS = {
  quote: Quote, stat: BarChart3, announce: Megaphone, cta: MousePointerClick,
}

// Brand-aware CSS background for the editor's background swatches + center frame.
function presetCss(preset, brandStyle) {
  const accent = brandStyle?.accent_color || '#0a7f3f'
  switch (preset) {
    case 'brand': return `linear-gradient(135deg, ${accent}, ${accent}cc)`
    case 'warm': return 'linear-gradient(135deg, #c2570f, #e8852e)'
    case 'light': return 'linear-gradient(135deg, #fde9d2, #f6dcc0)'
    case 'white': return '#ffffff'
    default: return '#475569'
  }
}

/**
 * TextPostStudio — Option B "text post studio". Layout gallery + block editor +
 * live canvas preview. "Use this post" bakes a real 1080×1080 JPEG (via the
 * carousel render→upload pipeline) and hands the URL + state back to the parent
 * to attach to media_urls and persist on content_items.text_card.
 *
 * Phase 1 ships 1:1 only (the renderer is square); the aspect toggle is shown
 * disabled with a "more soon" note rather than faked.
 */
export default function TextPostStudio({ pieceId, initialState, brandStyle, workspaceName, onClose, onUse }) {
  const [state, setState] = useState(() => initialState || defaultTextCardState('quote'))
  const [baking, setBaking] = useState(false)
  const canvasRef = useRef(null)

  const fields = (LAYOUTS[state.layout] || LAYOUTS.quote).fields

  // Re-render the live preview whenever the state changes (debounced).
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      if (cancelled || !canvasRef.current) return
      renderTextCard({ state, brandStyle, workspaceName, canvas: canvasRef.current }).catch(() => {})
    }, 120)
    return () => { cancelled = true; clearTimeout(t) }
  }, [state, brandStyle, workspaceName])

  const set = (patch) => setState((s) => ({ ...s, ...patch }))

  function pickLayout(id) {
    const l = LAYOUTS[id]
    // Apply the layout's defaults but keep whatever text the user already typed.
    setState((s) => ({
      ...s,
      layout: id,
      background: { ...l.defaults.background },
      size: l.defaults.size,
      position: l.defaults.position,
    }))
  }

  async function handleUse() {
    if (!state.headline.trim()) {
      toast.error('Add a headline first')
      return
    }
    setBaking(true)
    try {
      const url = await bakeTextCard({ pieceId, state, brandStyle, workspaceName })
      await onUse({ state, url })
    } catch (e) {
      toast.error('Could not create the card', { description: e?.message })
      setBaking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-5 py-3">
          <Type className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Text post studio</span>
          <span className="text-2xs text-muted-foreground">· no clip needed — make a clean branded post</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body: 3 panes */}
        <div className="grid flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[200px_minmax(0,1fr)_280px]">

          {/* LEFT: layouts */}
          <div className="border-b p-3 lg:border-b-0 lg:border-r">
            <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Layouts</div>
            <div className="space-y-0.5">
              {LAYOUT_IDS.map((id) => {
                const Icon = LAYOUT_ICONS[id]
                const active = state.layout === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => pickLayout(id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'
                    }`}
                  >
                    {Icon && <Icon className="h-3.5 w-3.5" />}
                    {LAYOUTS[id].label}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 flex items-start gap-1 text-3xs text-muted-foreground">
              <Bookmark className="mt-0.5 h-3 w-3 shrink-0" />
              Saved templates land here in a later update.
            </p>
          </div>

          {/* CENTER: live preview */}
          <div className="flex flex-col items-center justify-center gap-3 bg-muted/40 p-5">
            <div className="flex items-center gap-1 self-stretch text-2xs text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide">Live preview</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5">
                1:1 <span className="text-3xs text-muted-foreground">· 4:5 / 9:16 soon</span>
              </span>
            </div>
            <canvas
              ref={canvasRef}
              width={1080}
              height={1080}
              className="w-full max-w-[340px] rounded-xl border shadow-lg"
              style={{ aspectRatio: '1 / 1' }}
            />
          </div>

          {/* RIGHT: editor */}
          <div className="space-y-4 border-t p-4 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Edit the words</span>
              <span className="ml-auto text-3xs text-muted-foreground">from your caption</span>
            </div>

            <label className="block">
              <span className="text-2xs text-muted-foreground">Headline</span>
              <textarea
                rows={2}
                value={state.headline}
                onChange={(e) => set({ headline: e.target.value })}
                placeholder="The line that stops the scroll…"
                className="mt-1 w-full resize-none rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-primary"
              />
            </label>
            {fields.subtext && (
              <label className="block">
                <span className="text-2xs text-muted-foreground">Subtext</span>
                <input
                  value={state.subtext}
                  onChange={(e) => set({ subtext: e.target.value })}
                  placeholder="One supporting line…"
                  className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                />
              </label>
            )}
            {fields.cta && (
              <label className="block">
                <span className="text-2xs text-muted-foreground">Call to action</span>
                <input
                  value={state.cta}
                  onChange={(e) => set({ cta: e.target.value })}
                  placeholder="RSVP — link in bio"
                  className="mt-1 w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-primary"
                />
              </label>
            )}

            <div className="space-y-3 border-t pt-3">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Look</span>
              </div>
              <div>
                <span className="text-2xs text-muted-foreground">Background</span>
                <div className="mt-1.5 flex items-center gap-2">
                  {BACKGROUND_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set({ background: { preset: p.id } })}
                      title={p.label}
                      aria-label={p.label}
                      className={`h-7 w-7 rounded-full border ${state.background?.preset === p.id ? 'ring-2 ring-foreground ring-offset-2' : ''}`}
                      style={{ background: presetCss(p.id, brandStyle) }}
                    />
                  ))}
                  <span className="ml-1 text-3xs text-muted-foreground">from brand kit</span>
                </div>
              </div>
              <div>
                <span className="text-2xs text-muted-foreground">Headline size</span>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                  {SIZE_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set({ size: id })}
                      className={`rounded-lg border px-2 py-1 transition-colors ${state.size === id ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-2xs text-muted-foreground">Text position</span>
                <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                  {POSITION_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => set({ position: id })}
                      className={`rounded-lg border px-2 py-1 transition-colors ${state.position === id ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-2xs">
                <input
                  type="checkbox"
                  checked={state.showName}
                  onChange={(e) => set({ showName: e.target.checked })}
                  className="accent-primary"
                />
                Show brand name · top
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t px-5 py-3">
          <p className="text-3xs text-muted-foreground">
            Bakes a real 1080×1080 image and attaches it — it publishes, not just a preview.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleUse}
            disabled={baking}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {baking ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</> : <><Check className="h-3.5 w-3.5" /> Use this post</>}
          </button>
        </div>
      </div>
    </div>
  )
}
