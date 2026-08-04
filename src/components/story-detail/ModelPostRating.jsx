// ModelPostRating — the pre-publish "this composition came together well"
// signal (see src/lib/modelRating.js). Sibling of WinnerToggle, deliberately
// NOT the same flag: Winner is post-publish/audience-driven and feeds topic
// resurfacing; this is a human craft call, available any time, that feeds
// generation's per-platform exemplar pool (fetchTopExemplars in exemplars.js).
//
// Interaction: resting control → tap opens a popover with optional reason
// chips + a free-text note → "Use as a model" saves in one PATCH. Reasons and
// note are optional so the save is always one tap; they exist to sharpen what
// generation copies, not to gate the save.

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateContentItem } from '@/lib/queries'
import { MODEL_REASONS, MODEL_REASON_LABEL, MODEL_NOTE_MAX } from '@/lib/modelRating'

export default function ModelPostRating({ piece }) {
  const updateItem = useUpdateContentItem()
  const isModel = !!piece.is_model_post
  const [open, setOpen] = useState(false)
  const [reasons, setReasons] = useState([])
  const [note, setNote] = useState('')

  const toggleReason = (key) => {
    setReasons((prev) => (prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]))
  }

  const save = () => {
    if (updateItem.isPending) return
    updateItem.mutate(
      { id: piece.id, patch: { isModelPost: true, modelReasons: reasons, modelNote: note.trim() || null } },
      { onSuccess: () => setOpen(false) },
    )
  }

  const undo = () => {
    if (updateItem.isPending) return
    updateItem.mutate({ id: piece.id, patch: { isModelPost: false } })
  }

  if (isModel) {
    const savedReasons = Array.isArray(piece.model_reasons) ? piece.model_reasons : []
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/10 px-2.5 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
          <Sparkles className="h-3.5 w-3.5 fill-success" />
          The post came together
        </span>
        <button
          type="button"
          onClick={undo}
          disabled={updateItem.isPending}
          className="text-2xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          Undo
        </button>
        {(savedReasons.length > 0 || piece.model_note) && (
          <span className="sr-only">
            Because {savedReasons.map((r) => MODEL_REASON_LABEL[r] || r).join(', ')}
            {piece.model_note ? ` — ${piece.model_note}` : ''}
          </span>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setReasons([]); setNote('') } }}>
      <PopoverTrigger asChild>
        {/* Not amber: --action is the act-now/caution signal, which is the wrong
            family for a positive judgment. Not uncoloured either — a plain
            border read as inert, like a label rather than a button. Idle state
            uses --scheduled (violet), reused deliberately: this screen never
            shows that token for the piece's own status (the Scheduled/Published
            line above is plain text-foreground), so there's no collision with
            its "content queued to publish" meaning elsewhere in the app. Once
            actually marked it turns emerald (below) — violet is "you can click
            this", green is "this is set". Same row shape as WinnerToggle's row
            variant so the pair reads as one list. */}
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-scheduled/40 bg-scheduled/5 px-2.5 py-2 text-left transition-colors hover:border-scheduled/70 hover:bg-scheduled/10"
        >
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-scheduled">
            <Sparkles className="h-3.5 w-3.5" />
            The post came together
          </span>
          <span className="text-2xs font-semibold text-scheduled">Mark it</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">What made this one land?</p>
          <p className="text-2xs text-muted-foreground">Optional — tap any that fit. Skipping still saves it.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODEL_REASONS.map((r) => {
            const on = reasons.includes(r.key)
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => toggleReason(r.key)}
                aria-pressed={on}
                className={
                  on
                    ? 'rounded-full border border-primary bg-primary px-2.5 py-1 text-2xs font-semibold text-primary-foreground'
                    : 'rounded-full border border-border bg-card px-2.5 py-1 text-2xs font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {on ? '✓ ' : ''}{r.label}
              </button>
            )
          })}
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MODEL_NOTE_MAX))}
          rows={2}
          placeholder="Anything else that made it work? (optional)"
          className="min-h-0 text-xs"
        />
        <button
          type="button"
          onClick={save}
          disabled={updateItem.isPending}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-success px-3 py-2 text-xs font-semibold text-success-foreground hover:bg-success/90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Use as a model
        </button>
      </PopoverContent>
    </Popover>
  )
}
