// PostMetricsRow — compact post-performance chip row for published content.
//
// Shown beneath a content piece body when the piece has a buffer_update_id.
// Fetches via /api/post-analytics, which serves the latest engagement_snapshots
// row for the piece — the same daily-refreshed numbers the "What's working"
// widget and the scoring layer read. A Refresh icon forces a live pull from the
// network (and records a new snapshot) for a user who doesn't want to wait for
// tomorrow's cron.

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { usePostMetrics, queryKeys } from '@/lib/queries'
import { apiFetch } from '@/lib/api'

function StatChip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
      <span>{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value.toLocaleString()}</span>
    </span>
  )
}

// Legacy Buffer-sourced shape: { reach, engagement, clicks, impressions, shares }.
// Buffer's API reports no per-platform breakdown, so this stays a fixed set —
// unchanged from before the bundle.social migration.
function BufferStatChips({ metrics }) {
  return (
    <>
      <StatChip label="Reach" value={metrics.reach} />
      <StatChip label="Engagement" value={metrics.engagement} />
      <StatChip label="Clicks" value={metrics.clicks} />
      {metrics.impressions > 0 && <StatChip label="Impressions" value={metrics.impressions} />}
      {metrics.shares > 0 && <StatChip label="Shares" value={metrics.shares} />}
    </>
  )
}

// bundle.social-sourced shape: { impressions, views, reach, likes, comments,
// shares, saves } — the platform's own numbers, not a computed composite (Q,
// 2026-07-22: "just display everything we can get"). Every chip is gated on
// >0 rather than shown as a fake zero, because bundle sends the same 9-field
// shape for every platform whether or not that platform actually reports the
// field (see mapBundleMetrics in post-analytics.js) — a 0 here could mean
// "measured, genuinely zero" or "this platform never sends this field," and
// showing it as a confident zero would misrepresent the second case.
//
// Meta renamed "impressions" to "Views" in its own apps (2024); bundle's
// `views` field carries that same number for IG/FB. LinkedIn never populates
// `views` (its analytics only ever land in `impressions`), so the headline
// chip falls back to Impressions there rather than showing a permanent 0.
function BundleStatChips({ metrics }) {
  const headline = metrics.views > 0
    ? { label: 'Views', value: metrics.views }
    : { label: 'Impressions', value: metrics.impressions }
  return (
    <>
      {headline.value > 0 && <StatChip label={headline.label} value={headline.value} />}
      {metrics.reach > 0 && <StatChip label="Reached" value={metrics.reach} />}
      {metrics.likes > 0 && <StatChip label="Likes" value={metrics.likes} />}
      {metrics.comments > 0 && <StatChip label="Comments" value={metrics.comments} />}
      {metrics.shares > 0 && <StatChip label="Shares" value={metrics.shares} />}
      {metrics.saves > 0 && <StatChip label="Saves" value={metrics.saves} />}
    </>
  )
}

export default function PostMetricsRow({ contentItemId }) {
  const { data, isLoading, isFetching } = usePostMetrics(contentItemId)
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
      const res = await apiFetch(`/api/post-analytics?contentItemId=${encodeURIComponent(contentItemId)}&force=true`)
      qc.setQueryData(queryKeys.postMetrics(contentItemId), res)
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

  // `analytics_unavailable` is a real answer, not an absence: the network told
  // us it cannot report on this post type at all (an Instagram carousel or
  // story). Say so, rather than rendering nothing or a row of confident zeros —
  // both of which read as "this post got no engagement."
  if (data?.reason === 'analytics_unavailable') {
    return (
      <div className="flex items-center gap-1.5 pt-1">
        <span className="inline-flex items-center text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
          Analytics not available for this post type
        </span>
      </div>
    )
  }

  // Nothing to show yet — not published, no post id, or no snapshot recorded
  // for it. The daily refresh cron fills these in; Refresh forces one now.
  if (!data || !data.metrics) return null

  const { metrics } = data
  const isBundle = metrics.source === 'bundle'

  return (
    <div className="flex items-center gap-1.5 flex-wrap pt-1">
      {isBundle ? <BundleStatChips metrics={metrics} /> : <BufferStatChips metrics={metrics} />}
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
