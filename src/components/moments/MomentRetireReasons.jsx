// Shared chips + free-text body for a Retire verdict — same interaction as
// ModelPostRating's "what made this land" popover, mirrored for the opposite
// signal. Used inline by the queue popover and inside the two ConfirmDialogs
// (OnHandTab browse list, StoryDetail MomentsPanel) so a rejected quote's
// reason reads the same everywhere a moment can be retired.

import { Textarea } from '@/components/ui/textarea'
import { MOMENT_RETIRE_REASONS, MOMENT_RETIRE_NOTE_MAX } from '@/lib/momentRetire'

export default function MomentRetireReasons({ reasons, onToggleReason, note, onNoteChange }) {
  return (
    <div className="space-y-2.5">
      <p className="text-2xs text-muted-foreground">
        Optional — tap what fits. Skipping still retires it.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {MOMENT_RETIRE_REASONS.map((r) => {
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
        onChange={(e) => onNoteChange(e.target.value.slice(0, MOMENT_RETIRE_NOTE_MAX))}
        rows={2}
        placeholder="Why doesn't this one work? (optional)"
        className="min-h-0 text-xs"
      />
    </div>
  )
}
