import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton — content-shaped loading placeholder (originui model).
 *
 * Replaces the bare centered spinner where we can show the *shape* of what's
 * loading, which reads as faster than a spinner. Uses the --muted token with a
 * brand-radius default and an animated left-to-right shimmer sweep (see the
 * `shimmer` keyframes in tailwind.config.js). Pass `rounded-*` to override.
 */
const Skeleton = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    aria-hidden="true"
    className={cn(
      'rounded-md bg-muted',
      'bg-[linear-gradient(90deg,hsl(var(--muted))_0%,hsl(0_0%_100%/0.6)_50%,hsl(var(--muted))_100%)] bg-[length:200%_100%]',
      'animate-shimmer',
      className,
    )}
    {...props}
  />
))
Skeleton.displayName = 'Skeleton'

/**
 * MediaGridSkeleton — mirrors the MediaHub asset grid
 * (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`, aspect-video cards). Renders
 * while the library is loading so users see the grid forming, not a spinner.
 */
function MediaGridSkeleton({ count = 12, className }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2', className)}
    >
      <span className="sr-only">Loading media…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card overflow-hidden">
          <Skeleton className="aspect-video rounded-none" />
          <div className="p-1.5 space-y-1.5">
            <Skeleton className="h-2.5 w-3/4 rounded" />
            <Skeleton className="h-2 w-1/2 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export { Skeleton, MediaGridSkeleton }
