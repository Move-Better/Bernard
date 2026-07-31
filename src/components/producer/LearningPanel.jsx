import { useQuery } from '@tanstack/react-query'
import { Brain, Image as ImageIcon, Type, Layers } from 'lucide-react'
import { apiFetch } from '@/lib/api'

// "How Bernard is learning" — the owner's view of the teach → run → check-in
// loop (Phase 4, mockup-approved).
//
// Trust is stated in SENTENCES, with the number as supporting detail rather
// than the headline. An owner should never have to interpret a percentage to
// know whether Bernard is being watched — and for the states where no rate is
// reportable (no signal, or too small a sample) there is deliberately no number
// to interpret at all.
//
// Every line here comes from real counts over real rows. The cold state is not
// an edge case: format_source only began stamping when Phase 3a merged and
// media_source with migration 196, so "not enough yet" is the FIRST thing this
// panel will say for weeks. It has to read as honest rather than broken.

const DIMENSIONS = [
  { key: 'words',  label: 'Words',  icon: Type,      hint: 'Captions Bernard writes' },
  { key: 'format', label: 'Format', icon: Layers,    hint: 'Post, carousel or reel' },
  { key: 'media',  label: 'Media',  icon: ImageIcon, hint: 'The photo or clip attached' },
]

// One visual language for state. 'graduated' is the only one that reads as
// finished; everything else reads as in-progress, matching stillFlags().
const STATE_CHIP = {
  untracked:  { text: 'not tracked', cls: 'bg-destructive/10 text-destructive' },
  no_data:    { text: 'no data',     cls: 'bg-muted text-muted-foreground' },
  too_few:    { text: 'checking',    cls: 'bg-action/15 text-action' },
  checking:   { text: null,          cls: '' },
  graduated:  { text: 'running free', cls: 'bg-success/15 text-success' },
}

function Row({ dimension, trust }) {
  const Icon = dimension.icon
  const chip = STATE_CHIP[trust?.state] || STATE_CHIP.no_data
  const pct = typeof trust?.rate === 'number' ? Math.round(trust.rate * 100) : null
  // Amber above the graduation band, green at or under it. Only ever drawn when
  // a rate is actually reportable — a bar with no number behind it would imply
  // a measurement that hasn't been made.
  const barColor = pct == null ? null : pct <= 5 ? 'hsl(var(--success))' : 'hsl(var(--action))'

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold">{dimension.label}</span>
          <span className="hidden sm:inline text-3xs text-muted-foreground truncate">{dimension.hint}</span>
        </span>
        {pct != null
          ? <span className="text-xs font-bold tabular-nums shrink-0">{pct}%</span>
          : chip.text && (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-3xs font-bold ${chip.cls}`}>
                {chip.text}
              </span>
            )}
      </div>

      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{trust?.say}</p>

      <div
        className="mt-2 h-1 rounded-full bg-border overflow-hidden"
        role="img"
        aria-label={pct == null ? `${dimension.label}: no rate available` : `${dimension.label}: ${pct}% changed`}
      >
        {pct != null && (
          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: barColor }} />
        )}
      </div>
    </div>
  )
}

export default function LearningPanel() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['producer-learning'],
    queryFn: () => apiFetch('/api/producer/learning'),
    staleTime: 5 * 60 * 1000,
  })

  // A failed read must not render as an empty (and therefore reassuring) panel.
  if (isError) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">Couldn’t load the learning summary just now.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline gap-2">
        <Brain className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">How Bernard is learning</h2>
        {data?.window?.days && (
          <span className="ml-auto text-3xs text-muted-foreground">last {data.window.days} days</span>
        )}
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
        How often you change Bernard’s choice. The more Bernard gets right, the less it interrupts you.
      </p>

      <div className="mt-2">
        {isLoading
          ? DIMENSIONS.map((d) => (
              <div key={d.key} className="py-3 border-b border-border last:border-b-0">
                <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                <div className="mt-2 h-2 w-3/4 rounded bg-muted animate-pulse" />
              </div>
            ))
          : DIMENSIONS.map((d) => (
              <Row key={d.key} dimension={d} trust={data?.dimensions?.[d.key]} />
            ))}
      </div>
    </div>
  )
}
