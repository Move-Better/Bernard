// F6 Phase 4 — Settings → Practice Brain. Permanent home for the supersession
// review queue (the Overview card is the proactive surface; this is the
// always-findable one, and the natural place to later grow an "ask your
// practice" surface).

import { Brain } from 'lucide-react'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { usePracticeBrainSupersessions } from '@/lib/practiceBrain'
import { PracticeBrainReviewList } from '@/components/PracticeBrainReview'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/ui/PageHeader'

export default function PracticeBrainSettings() {
  useDocumentTitle('Practice Brain')
  const { data: items = [], isLoading } = usePracticeBrainSupersessions()

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        icon={Brain}
        title="Practice Brain"
        subtitle="Bernard learns from every interview and post. When your thinking on a topic looks like it changed, it asks before letting the newer take win — so generated content reflects how you practice today."
      />

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Brain className="h-6 w-6 mx-auto text-muted-foreground mb-2" aria-hidden="true" />
          <p className="text-sm font-medium">Your practice brain is up to date</p>
          <p className="text-xs text-muted-foreground mt-1">
            No conflicting takes to resolve. Bernard will nudge you here if your thinking on a topic shifts.
          </p>
        </div>
      ) : (
        <PracticeBrainReviewList items={items} />
      )}
    </div>
  )
}
