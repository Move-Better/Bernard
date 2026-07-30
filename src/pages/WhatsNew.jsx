// /updates — the full, paginated "what's new in Bernard" history. The
// ProducerHome card (src/components/producer-home/UpdatesFeed.jsx) shows the
// latest 5 with a link here for everything else. See .claude/decisions.md
// 2026-07-29/30 for the product_updates feed's origin.
import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorState from '@/components/ErrorState'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import BackLink from '@/components/ui/BackLink'

const PAGE_SIZE = 20

function timeAgo(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default function WhatsNew() {
  useDocumentTitle('What’s new')

  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['product-updates', 'producer', 'full'],
    queryFn: ({ pageParam = 0 }) => apiFetch(`/api/product-updates?role=producer&limit=${PAGE_SIZE}&offset=${pageParam}`),
    initialPageParam: 0,
    // A page's RAW size (before role filtering) determines whether more rows
    // exist upstream — a role-filtered page can be short even when there's
    // more to fetch. See product-updates.js's pageSize field.
    getNextPageParam: (lastPage, allPages) => (
      (lastPage?.pageSize || 0) < PAGE_SIZE ? undefined : allPages.length * PAGE_SIZE
    ),
    staleTime: 5 * 60_000,
  })

  const updates = (data?.pages || []).flatMap((p) => p?.updates || [])

  if (error) return <ErrorState message="Couldn't load updates." onRetry={refetch} />

  return (
    <div className="flex flex-col gap-4 py-6">
      <div>
        <BackLink to="/">Back to Home</BackLink>
        <h1 className="mt-2 text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">What&rsquo;s new in Bernard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Every change Bernard has made that&rsquo;s relevant to how you work, newest first.</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : updates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing to show yet.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {updates.map((u) => (
            <div key={u.id} className="p-4 text-sm">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{timeAgo(u.created_at)}</div>
              <div className="max-w-[70ch]">{u.summary}</div>
            </div>
          ))}
        </div>
      )}

      {hasNextPage && (
        <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="self-center">
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
