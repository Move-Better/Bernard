// The Insights trend strip — one bar per period for the active tab's headline
// metric (social reach / website sessions / search clicks), sitting under the
// shared period picker and doubling as a picker itself: click a bar to jump
// the whole page to that period. Same interaction language as the Overview
// recap's trend band. Pure presentational.

function shortPeriodLabel(periodStart, granularity) {
  const d = new Date(`${periodStart}T00:00:00Z`)
  if (granularity === 'year') return String(d.getUTCFullYear())
  if (granularity === 'month') return d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const WIP_HATCH = {
  backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0 3px, hsl(var(--card) / 0.55) 3px 6px)',
}

const fmtShort = (n) => {
  const v = Number(n) || 0
  if (v >= 10000) return `${Math.round(v / 1000)}k`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return v.toLocaleString()
}

export default function TrendStrip({
  series = [],
  granularity = 'week',
  metric,            // key into each series entry, e.g. 'reach' | 'sessions' | 'clicks'
  metricLabel,       // legend text, e.g. 'reach'
  selectedOffset = 0,
  onSelect,
  tooltipFor,        // optional (entry) => string for the hover title
}) {
  if (!series.length) return null
  const values = series.map((p) => Number(p[metric]) || 0)
  if (!values.some((v) => v > 0)) return null // nothing measured yet — no empty chrome
  const max = Math.max(...values, 1)
  const unit = granularity === 'year' ? 'year' : granularity === 'month' ? 'month' : 'week'

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-3.5 mb-4">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h3 className="text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">
          {metricLabel} — last {series.length} {unit}s
        </h3>
        <span className="ml-auto text-2xs text-muted-foreground opacity-75 hidden sm:inline">
          click a {unit} to open it
        </span>
      </div>
      <div className="flex gap-1 sm:gap-1.5 items-end">
        {series.map((p) => {
          const isWip = p.offset === 0
          const selected = p.offset === selectedOffset
          const h = Math.round(((Number(p[metric]) || 0) / max) * 44) + 2
          return (
            <button
              key={p.period_start}
              onClick={() => onSelect?.(p.offset)}
              aria-label={`${shortPeriodLabel(p.period_start, granularity)}: ${Number(p[metric]) || 0} ${metricLabel}`}
              aria-pressed={selected}
              title={tooltipFor ? tooltipFor(p) : undefined}
              className={`flex-1 min-w-0 flex flex-col items-center rounded-lg border px-0.5 pt-1 pb-1 transition-colors ${
                selected ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:bg-muted/70'
              }`}
            >
              <span className="flex items-end justify-center h-[48px] w-full" aria-hidden="true">
                <span
                  className="w-[55%] max-w-[22px] rounded-t-[3px] bg-primary/70"
                  style={{ height: `${h}px`, ...(isWip ? WIP_HATCH : {}) }}
                />
              </span>
              <span className="text-2xs font-bold tabular-nums" aria-hidden="true">{fmtShort(p[metric])}</span>
              <span className="text-3xs text-muted-foreground whitespace-nowrap" aria-hidden="true">
                {shortPeriodLabel(p.period_start, granularity)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
