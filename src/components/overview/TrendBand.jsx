// The Overview recap's 12-week trend band — paired published/captured bars per
// calendar week, doubling as the week picker (click a week to open it in the
// recap). Data comes from workspace_recap()'s `trend` (migration 175); the
// current in-progress week renders hatched. Pure presentational — offset math
// stays in the parent.

function shortWeekLabel(weekStart) {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// Diagonal hatching over a bar marks the still-in-progress week.
const WIP_HATCH = {
  backgroundImage: 'repeating-linear-gradient(-45deg, transparent 0 3px, hsl(var(--card) / 0.55) 3px 6px)',
}

export default function TrendBand({ trend = [], selectedOffset = 0, floorOffset = 0, onSelectWeek }) {
  if (!trend.length) return null
  const max = Math.max(1, ...trend.map((t) => Math.max(t.published || 0, t.captured || 0)))
  const last = trend.length - 1

  return (
    <div className="px-5 py-3.5 border-b border-border">
      <div className="flex items-baseline gap-3 mb-2 flex-wrap">
        <h3 className="text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">The last 12 weeks</h3>
        <div className="ml-auto flex items-center gap-4 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-success inline-block" aria-hidden="true" /> published
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/45 inline-block" aria-hidden="true" /> captured
          </span>
          <span className="hidden sm:inline opacity-75">click a week to open it</span>
        </div>
      </div>
      <div className="flex gap-1 sm:gap-1.5 items-end">
        {trend.map((t, i) => {
          const offset = i - last // 0 = current week, negative = past
          const isWip = offset === 0
          const selected = offset === selectedOffset
          const reachable = offset >= floorOffset
          const pubH = Math.round(((t.published || 0) / max) * 48) + 2
          const capH = Math.round(((t.captured || 0) / max) * 48) + 2
          return (
            <button
              key={t.week_start}
              onClick={() => reachable && onSelectWeek?.(offset)}
              disabled={!reachable}
              aria-label={`Week of ${shortWeekLabel(t.week_start)}: ${t.published || 0} published, ${t.captured || 0} captured`}
              aria-pressed={selected}
              className={`flex-1 min-w-0 flex flex-col items-center rounded-lg border px-0.5 pt-1 pb-1 transition-colors ${
                selected
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-transparent hover:bg-muted/70'
              } ${reachable ? '' : 'opacity-40 cursor-default'}`}
            >
              <span className="flex items-end justify-center gap-[3px] h-[52px] w-full" aria-hidden="true">
                <span
                  className="w-[38%] max-w-[14px] rounded-t-[3px] bg-success"
                  style={{ height: `${pubH}px`, ...(isWip ? WIP_HATCH : {}) }}
                />
                <span
                  className="w-[38%] max-w-[14px] rounded-t-[3px] bg-primary/45"
                  style={{ height: `${capH}px`, ...(isWip ? WIP_HATCH : {}) }}
                />
              </span>
              <span className="text-2xs font-bold tabular-nums" aria-hidden="true">{t.published || 0}</span>
              <span className="text-3xs text-muted-foreground whitespace-nowrap" aria-hidden="true">{shortWeekLabel(t.week_start)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
