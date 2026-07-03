import { Link } from 'react-router-dom'
import { Bot, ChevronRight } from 'lucide-react'
import { useProducerFeed } from '@/lib/queries'
import WorkdayFeed from '@/components/producer/WorkdayFeed'

// Compact "Bernard's workday" strip for /week (Standing Producer Phase 0).
// Self-contained: fetches its own latest few actions and renders NOTHING when
// the workspace hasn't hired Bernard or has no activity yet — so /week is
// unchanged for workspaces that haven't opted in.
export default function ProducerFeedStrip() {
  const { data } = useProducerFeed(3)
  if (!data?.enabled) return null
  const actions = data.actions || []
  if (actions.length === 0) return null

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Bernard’s workday</span>
        <Link
          to="/producer"
          className="ml-auto inline-flex items-center gap-0.5 text-2xs font-medium text-primary hover:underline"
        >
          See all <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <WorkdayFeed actions={actions} compact />
    </div>
  )
}
