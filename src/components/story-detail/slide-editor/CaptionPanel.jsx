import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Type, AlertTriangle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { CAPTION_LIMITS, PLATFORM_META } from '@/lib/contentMeta'

// ── Caption panel (the "Words" rail tool) ─────────────────────────────────────
// Renders inside the inspector when the Words tool is selected.

export default function CaptionPanel({ piece, onUseAsHook, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)
  const taRef = useRef(null)

  useEffect(() => {
    const next = typeof piece?.content === 'string' ? piece.content : ''
    setDraft(next)
    savedRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

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
  // text at publish time (api/_routes/publish/buffer.js), so this is the only
  // place the author can see and fix it before that happens.
  const limit = CAPTION_LIMITS[piece?.platform]
  const overLimit = limit ? draft.length > limit : false
  const nearLimit = limit ? !overLimit && draft.length > limit * 0.9 : false

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
                onClick={() => {
                  const firstLine = (draft || '').split('\n')[0].trim()
                  if (firstLine) onUseAsHook(firstLine)
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
              >
                ↑ Use as slide hook
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy the first line of the caption into slide 1&apos;s hook text block</TooltipContent>
          </Tooltip>
          <span className={`text-sm ${overLimit ? 'text-destructive font-semibold' : nearLimit ? 'text-warning font-semibold' : 'text-muted-foreground'}`}>
            {limit ? `${draft.length} / ${limit}` : `${draft.length} chars`}
          </span>
        </div>
      </div>
    </div>
  )
}
