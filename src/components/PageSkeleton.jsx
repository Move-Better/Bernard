import { Skeleton } from '@/components/ui/skeleton'

// PageSkeleton — content-shaped loading placeholder for a full page, gated on a
// page's primary query's isPending/isLoading so the page never flashes its
// empty/zero state before data arrives. Mirrors the Home.jsx skeleton approach
// but shared so every data page gets a consistent loader with a one-line gate:
//
//   if (isPending) return <PageSkeleton variant="dashboard" />
//
// Variants approximate the common page shapes. They don't need to match pixel-
// for-pixel — they just need to occupy the same region so there's no layout
// jump or empty-state flash. Pass `header={false}` for pages that render their
// own chrome above the loader.
export default function PageSkeleton({ variant = 'dashboard', header = true, rows = 6, cards = 4 }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>

      {header && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
      )}

      {variant === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: cards }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-56 rounded-xl md:col-span-2" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
          <Skeleton className="h-40 rounded-xl" />
        </>
      )}

      {variant === 'list' && (
        <div className="space-y-2">
          {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      )}

      {variant === 'grid' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: rows * 2 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)}
        </div>
      )}

      {variant === 'detail' && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3 md:col-span-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        </div>
      )}
    </div>
  )
}
