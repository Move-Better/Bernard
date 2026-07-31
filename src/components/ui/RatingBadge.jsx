import { ratingBand, ratingTooltip } from '@/lib/ratingBands'

// The one badge for anything Bernard auto-rates. Thresholds, words, tones and
// tooltip all come from @/lib/ratingBands so no surface can drift from another
// (the rule this replaces had already been copy-pasted into two files).
//
// Two sizes, same vocabulary:
//   md — the review-queue card, where a verdict is being made about the item
//   sm — dense list rows, where the badge is a scanning aid
//
// An unscored item renders a muted em-dash rather than a band: calling it
// "Weak" because we have no number would be a claim we have not earned.

const SIZES = {
  md: {
    box:  'w-[54px] gap-px px-1 pt-1.5 pb-1 rounded-lg',
    num:  'text-sm leading-none',
    cap:  'text-3xs',
    dash: 'w-[54px] py-2 rounded-lg text-sm',
  },
  sm: {
    box:  'w-[46px] gap-px px-1 py-1 rounded-md',
    num:  'text-2xs leading-none',
    cap:  'text-3xs',
    dash: 'w-[46px] py-1.5 rounded-md text-2xs',
  },
}

export default function RatingBadge({ score, signal = 'quote', size = 'md', className = '' }) {
  const band = ratingBand(score, signal)
  const s = SIZES[size] || SIZES.md
  const tip = ratingTooltip(score, signal)

  if (!band) {
    return (
      <span
        title={tip}
        className={`shrink-0 self-start inline-flex items-center justify-center border border-transparent bg-muted text-muted-foreground font-bold tabular-nums ${s.dash} ${className}`}
      >
        —<span className="sr-only">Not scored yet</span>
      </span>
    )
  }

  return (
    <span
      title={tip}
      className={`shrink-0 self-start inline-flex flex-col items-center justify-center border font-bold tabular-nums ${band.bg} ${band.text} ${band.border} ${s.box} ${className}`}
    >
      <span className={s.num}>{band.score}</span>
      <span className={`${s.cap} font-bold uppercase tracking-wide opacity-90`}>{band.label}</span>
    </span>
  )
}
