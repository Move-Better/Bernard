import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Type, AlertTriangle, Sparkles, Loader2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CAPTION_LIMITS, PLATFORM_META } from '@/lib/contentMeta'
import { useGenerateSlideHook } from '@/lib/queries'
import RegenerateCaptionButton, { canRegenerateCaption } from '@/components/editor/RegenerateCaptionButton'

// ── Caption panel (the "Words" rail tool) ─────────────────────────────────────
// Renders inside the inspector when the Words tool is selected.

export default function CaptionPanel({ piece, onUseAsHook, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)
  const taRef = useRef(null)

  // Re-seed the textarea on piece switch AND when the persisted content changes
  // underneath us — e.g. Regenerate replaces content in place (same id). The
  // savedRef guard means unsaved local edits (which differ from savedRef while
  // the incoming prop still equals it) are never clobbered.
  useEffect(() => {
    const next = typeof piece?.content === 'string' ? piece.content : ''
    if (next !== savedRef.current) {
      setDraft(next)
      savedRef.current = next
    }
  }, [piece?.id, piece?.content])

  async function handleBlur() {
    if (draft === savedRef.current) return
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { content: draft } })
      savedRef.current = draft
    } catch (e) {
      toast.error('Caption save failed', { description: e.message })
    }
  }

  // Not every platform caps captions (see CAPTION_LIMITS) — only warn when
  // the destination actually enforces one. GBP silently truncates over-limit
  // text at publish time (api/_routes/publish/social.js), so this is the only
  // place the author can see and fix it before that happens.
  const limit = CAPTION_LIMITS[piece?.platform]
  const overLimit = limit ? draft.length > limit : false
  const nearLimit = limit ? !overLimit && draft.length > limit * 0.9 : false

  // "Generate slide hook" — ask the model for a short (≤8-word) scroll-stopper
  // built from the caption, and drop it into slide 1. Falls back to the
  // caption's first line when the model can't produce a usable hook (or the
  // call fails), so the button always does something — that first-line copy is
  // exactly the old behavior this replaces.
  const generateHook = useGenerateSlideHook()
  async function handleGenerateHook() {
    const caption = (draft || '').trim()
    if (!caption) return
    const firstLine = caption.split('\n')[0].trim()
    try {
      const { hook } = await generateHook.mutateAsync({ caption, platform: piece?.platform })
      if (hook) {
        onUseAsHook(hook)
      } else if (firstLine) {
        toast.message('Couldn’t shorten this into a hook — used the caption’s first line.')
        onUseAsHook(firstLine)
      }
    } catch {
      // useAppMutation already surfaces the error toast; still give the user
      // the first-line fallback so the click isn't wasted.
      if (firstLine) onUseAsHook(firstLine)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground/80">
          <Type className="h-4 w-4" /> Caption
        </span>
      </div>
      {/* Clicking the panel's padding/gaps (outside the textarea's own box) used
          to be a dead click; focus the field so any click in the caption area
          lands the cursor in it. Guard on currentTarget so clicks on the button
          row / warning don't steal focus. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
        onClick={(e) => { if (e.target === e.currentTarget) taRef.current?.focus() }}
      >
        <textarea
          ref={taRef}
          aria-label="Caption"
          spellCheck
          lang="en"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder="Caption visible to followers…"
          className="min-h-[160px] flex-1 w-full resize-none rounded-xl border bg-muted/40 px-3 py-2.5 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:border-primary focus:outline-none"
        />
        {overLimit && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {PLATFORM_META[piece.platform]?.label || 'This platform'} caps captions at {limit} characters — the last {draft.length - limit} will be cut off when published.
            </span>
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleGenerateHook}
                disabled={!draft.trim() || generateHook.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generateHook.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {generateHook.isPending ? 'Writing hook…' : 'Generate slide hook'}
              </button>
            </TooltipTrigger>
            <TooltipContent>Write a short attention-drawing hook from this caption and drop it into slide 1</TooltipContent>
          </Tooltip>
          <span className={`text-sm ${overLimit ? 'text-destructive font-semibold' : nearLimit ? 'text-warning font-semibold' : 'text-muted-foreground'}`}>
            {limit ? `${draft.length} / ${limit}` : `${draft.length} chars`}
          </span>
        </div>
        {canRegenerateCaption(piece) && (
          <div className="shrink-0 border-t pt-3">
            <RegenerateCaptionButton piece={piece} />
          </div>
        )}
      </div>
    </div>
  )
}
