// WinnerToggle — the human "this one worked" signal for published content.
//
// V5 (engagement loop): published pieces carry a `performed_well` boolean. A
// story director flips it on when the audience responded — comments, shares,
// bookings, a partner mentioning it in clinic. That flag is the producer end
// of the loop: the Moment Miner's Coverage tab rolls winners up per topic/clinician,
// and the daily lineup resurfaces proven topics first (see getSuggestedTopics'
// provenTopics param). When GA4 / Buffer metrics eventually flow, the
// refresh-engagement cron can auto-set the same flag — this toggle is the
// manual seed that makes the loop real today.
//
// Rendered beneath PostMetricsRow on published pieces in AssetsPane.

import { Trophy } from 'lucide-react'
import { useUpdateContentItem } from '@/lib/queries'

// `variant` — 'chip' for the compact Stories monitor row, 'row' for the
// published receipt, where it sits directly under ModelPostRating and has to
// match its full-width shape (a chip beside a full-width bar read as a
// truncated, half-disabled control).
//
// Colour follows the same rule as ModelPostRating, and the two must move
// together: idle uses --scheduled (violet) so the control reads as clickable
// rather than a plain status label — a flat neutral border/text read as inert,
// and muted-on-muted before that read as disabled. Once actually marked it
// turns emerald: violet = "you can click this", green = "this is set". Not
// amber (--action is the act-now/caution signal, wrong family for a positive
// judgment) and not --primary/teal (that's the brand colour, used for
// navigation — a rating control in the same hue reads as a link, not a verdict).
export default function WinnerToggle({ piece, variant = 'chip' }) {
  const updateItem = useUpdateContentItem()
  const isWinner = !!piece.performed_well
  const isRow = variant === 'row'

  const toggle = () => {
    if (updateItem.isPending) return
    updateItem.mutate({ id: piece.id, patch: { performedWell: !isWinner } })
  }

  const shape = isRow
    ? 'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left border transition-colors disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-colors disabled:opacity-50'

  const tone = isWinner
    ? 'bg-success/10 text-success border-success/40 hover:bg-success/20'
    : 'bg-scheduled/5 text-scheduled border-scheduled/40 hover:border-scheduled/70 hover:bg-scheduled/10'

  return (
    <div className={isRow ? '' : 'flex items-center gap-2 pt-1'}>
      <button
        type="button"
        onClick={toggle}
        disabled={updateItem.isPending}
        aria-pressed={isWinner}
        className={`text-xs font-semibold ${shape} ${tone}`}
        title={
          isWinner
            ? 'Marked — the audience responded to this one. Bernard brings this topic back sooner. Click to unmark.'
            : 'Mark this when the audience responded — comments, shares, bookings. Bernard brings this topic back sooner.'
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Trophy className={`h-3.5 w-3.5 ${isWinner ? 'fill-success' : ''}`} />
          The audience responded
        </span>
        {/* The row variant mirrors ModelPostRating's trailing affordance so the
            two sit as a matched pair rather than a bar next to a chip. */}
        {isRow && (
          <span className="text-2xs font-semibold">
            {isWinner ? 'Marked' : 'Mark it'}
          </span>
        )}
      </button>
    </div>
  )
}
