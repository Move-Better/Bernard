// GbpInsightsRow — per-post Google Business Profile view chip.
//
// Shown beneath a GBP content piece once the daily cron has matched it to
// a local post and fetched view counts from the reportInsights API.

import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useGbpMetrics, queryKeys } from '@/lib/queries'

function StatChip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
      <span>{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value.toLocaleString()}</span>
    </span>
  )
}

export default function GbpInsightsRow({ contentItemId }) {
  const { data, isFetching } = useGbpMetrics(contentItemId)
  const qc = useQueryClient()

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.gbpMetrics(contentItemId) })
  }

  // No data yet, or not a GBP post
  if (!data || !data.metrics) return null

  const { metrics } = data

  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-1">
      {metrics.views > 0 && <StatChip label="Views" value={metrics.views} />}
      {metrics.actions > 0 && <StatChip label="Actions" value={metrics.actions} />}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isFetching}
        className="ml-auto inline-flex items-center text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        aria-label="Refresh GBP metrics"
        title="Refresh metrics"
      >
        <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
