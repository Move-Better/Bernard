// BufferMetricsRow — compact post-performance chip row for published content.
//
// Shown beneath a content piece body when the piece has a buffer_update_id.
// Fetches via /api/buffer-analytics (30-min client-side cache) and shows
// reach, engagement, and clicks at a glance. A Refresh icon forces a re-fetch
// so the user can pull the latest numbers without waiting for the cache to
// expire.

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useBufferMetrics, queryKeys } from '@/lib/queries'
import { apiFetch } from '@/lib/api'

function StatChip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
      <span>{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value.toLocaleString()}</span>
    </span>
  )
}

export default function BufferMetricsRow({ contentItemId }) {
  const { data, isLoading, isFetching } = useBufferMetrics(contentItemId)
  const qc = useQueryClient()
  const [forcing, setForcing] = useState(false)

  // A plain invalidate/refetch re-runs the same non-forcing GET — for a
  // bundle.social-provider workspace that returns the same cached-by-bundle
  // reading, since bundle only advances its analytics history on a FORCED
  // read. Call the endpoint directly with force=true so the click actually
  // does something.
  const handleRefresh = async () => {
    setForcing(true)
    try {
      const res = await apiFetch(`/api/buffer-analytics?contentItemId=${encodeURIComponent(contentItemId)}&force=true`)
      qc.setQueryData(queryKeys.bufferMetrics(contentItemId), res)
    } catch {
      // Leave the existing cached data in place — a transient failure here
      // shouldn't blank out numbers the user could already see.
    } finally {
      setForcing(false)
    }
  }

  // Don't render while loading the first time — avoid layout shift
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 pt-1">
        <div className="h-5 w-32 rounded bg-muted animate-pulse" />
        <div className="h-5 w-20 rounded bg-muted animate-pulse" />
        <div className="h-5 w-24 rounded bg-muted animate-pulse" />
      </div>
    )
  }

  // No metrics available (not published, no Buffer ID, or Buffer not configured)
  if (!data || !data.metrics) return null

  const { metrics } = data

  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-1">
      <StatChip label="Reach" value={metrics.reach} />
      <StatChip label="Engagement" value={metrics.engagement} />
      <StatChip label="Clicks" value={metrics.clicks} />
      {metrics.impressions > 0 && <StatChip label="Impressions" value={metrics.impressions} />}
      {metrics.shares > 0 && <StatChip label="Shares" value={metrics.shares} />}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isFetching || forcing}
        className="ml-auto inline-flex items-center text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        aria-label="Refresh metrics"
        title="Refresh metrics"
      >
        <RefreshCw className={`h-3 w-3 ${isFetching || forcing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  )
}
