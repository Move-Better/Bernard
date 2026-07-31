// Shared chips + free-text body for a clip Deny verdict — the sibling of
// MomentRetireReasons, same interaction, its own vocabulary (see
// src/lib/clipDiscard.js for why the two lists are deliberately separate).

import { Textarea } from '@/components/ui/textarea'
import { CLIP_DISCARD_REASONS, CLIP_DISCARD_NOTE_MAX } from '@/lib/clipDiscard'

export default function ClipDiscardReasons({ reasons, onToggleReason, note, onNoteChange }) {
  return (
    <div className="space-y-2.5">
      <p className="text-2xs text-muted-foreground">
        Optional — tap what fits. Skipping still denies it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {CLIP_DISCARD_REASONS.map((r) => {
          const on = reasons.includes(r.key)
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => onToggleReason(r.key)}
              aria-pressed={on}
              className={
                on
                  ? 'rounded-full border border-destructive bg-destructive px-2.5 py-1 text-2xs font-semibold text-destructive-foreground'
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
        onChange={(e) => onNoteChange(e.target.value.slice(0, CLIP_DISCARD_NOTE_MAX))}
        rows={2}
        placeholder="What's wrong with this clip? (optional)"
        className="min-h-0 text-xs"
      />
    </div>
  )
}
