// "What's new in Bernard" — role-tagged, generated feed (P3). Replaces the
// hand-maintained release-notes.json for role-targeted announcements; see
// scripts/generate-product-updates.mjs for how entries are written.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

function timeAgo(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default function UpdatesFeed() {
  const { data, isLoading } = useQuery({
    queryKey: ['product-updates', 'producer'],
    queryFn: () => apiFetch('/api/product-updates?role=producer'),
    staleTime: 5 * 60_000,
  })

  const updates = (data?.updates || []).slice(0, 5)

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">What&rsquo;s new in Bernard</div>
        <Link to="/updates" className="text-2xs font-semibold text-primary hover:underline">See all →</Link>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      ) : updates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing new to report this week.</p>
      ) : (
        <div className="flex flex-col">
          {updates.map((u) => (
            <div key={u.id} className="border-t border-border first:border-t-0 py-2 text-sm">
              <span className="text-2xs text-muted-foreground mr-2">{timeAgo(u.created_at)}</span>
              {u.summary}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
