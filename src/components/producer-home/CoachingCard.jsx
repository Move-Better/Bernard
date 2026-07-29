// Bernard's weekly coaching note — reads the cached note written by
// scripts/generate-coaching-note.mjs (P4). One paragraph of "how to work
// Bernard this week", generated from what shipped + this workspace's live
// checkpoint/health state. Same engine for every tenant.
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

export default function CoachingCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['producer-coaching-note'],
    queryFn: () => apiFetch('/api/producer/coaching-note'),
    staleTime: 5 * 60_000,
  })

  const note = data?.note

  return (
    <div className="rounded-lg border border-l-[3px] border-primary bg-card p-4">
      <div className="text-2xs font-bold uppercase tracking-wide text-primary">Bernard&rsquo;s note for this week</div>
      {isLoading ? (
        <div className="mt-2 flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : note ? (
        <p className="mt-2 text-sm text-foreground whitespace-pre-line max-w-[66ch]">{note.note}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Your first weekly note lands Monday — Bernard writes it from what shipped and how your queue looks.
        </p>
      )}
    </div>
  )
}
