import { Bot, Pause, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useProducerFeed } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { ROLE_ADMIN } from '@/lib/roles'
import WorkdayFeed from '@/components/producer/WorkdayFeed'
import NeedsYouStrip from '@/components/producer/NeedsYouStrip'

// /producer — "Bernard's workday" (Standing Producer Phase 0). The append-only
// feed of what Bernard has done for this workspace. Read-only in Phase 0;
// controls (pause, caps) land in Phase 4. Any workspace member can view.

export default function Producer() {
  useDocumentTitle('Bernard')
  const { data, isLoading } = useProducerFeed(30)
  const { role } = useUserRole()
  const isAdmin = role === ROLE_ADMIN

  const enabled = data?.enabled
  const paused = Boolean(data?.pausedAt)
  const actions = data?.actions || []

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
            Bernard’s workday
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Everything Bernard does for you, as it happens — drafts made, weeks planned, posts published.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enabled && (
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${paused ? 'bg-muted text-muted-foreground' : 'bg-success/10 text-success'}`}>
              {paused ? <><Pause className="w-3.5 h-3.5" /> Paused</> : <><span className="w-1.5 h-1.5 rounded-full bg-success" /> Always on</>}
            </span>
          )}
          {isAdmin && (
            <Link
              to="/producer/settings"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold hover:bg-muted"
            >
              <Settings className="h-4 w-4" aria-hidden="true" /> Settings
            </Link>
          )}
        </div>
      </div>

      {/* Needs you — the things Bernard couldn't clear on his own (self-hides when
          the producer is off or nothing is outstanding). */}
      {enabled && <div className="mt-4"><NeedsYouStrip /></div>}

      {isLoading ? (
        <div className="space-y-3 mt-6">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : !enabled ? (
        <div className="mt-6 bg-card border border-border rounded-xl p-8 text-center">
          <Bot className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-base font-semibold">Bernard isn’t on this workspace’s team yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Once Bernard is hired as your producer, this is where you’ll see the work — every draft,
            plan, and publish — as a running log.
          </p>
        </div>
      ) : (
        <div className="mt-6 bg-card border border-border rounded-xl p-5">
          <WorkdayFeed actions={actions} emptyLabel="No activity yet — as soon as Bernard drafts, plans, or publishes, it’ll show up here." />
        </div>
      )}
    </div>
  )
}
