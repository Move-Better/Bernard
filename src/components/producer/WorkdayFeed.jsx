import { PenLine, CalendarRange, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react'
import { formatTimeAgo } from '@/lib/utils'

// Bernard's workday feed (Standing Producer Phase 0). Renders the agent_actions
// ledger as a colleague's standup — one line per thing Bernard did. Shared by
// the /producer page (full) and the /week strip (compact). Presentational only;
// data comes from useProducerFeed.

// Each action kind → icon + accent. Accents use design tokens (never raw hex):
// primary = Bernard made/planned something; success = a win; destructive = a
// problem that needs a human.
const KIND_META = {
  draft_created:  { icon: PenLine,       cls: 'bg-primary/10 text-primary' },
  week_planned:   { icon: CalendarRange, cls: 'bg-primary/10 text-primary' },
  published:      { icon: CheckCircle2,  cls: 'bg-success/10 text-success' },
  publish_failed: { icon: AlertTriangle, cls: 'bg-destructive/10 text-destructive' },
}
const FALLBACK_META = { icon: Sparkles, cls: 'bg-muted text-muted-foreground' }

function FeedRow({ action, compact }) {
  const meta = KIND_META[action.kind] || FALLBACK_META
  const Icon = meta.icon
  const platform = action.detail?.platform
  return (
    <li className="flex gap-3">
      <div className={`shrink-0 grid place-items-center rounded-full ${compact ? 'w-6 h-6' : 'w-7 h-7'} ${meta.cls}`}>
        <Icon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`${compact ? 'text-xs' : 'text-sm'} leading-snug text-foreground`}>{action.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-2xs text-muted-foreground">{formatTimeAgo(action.created_at)}</span>
          {platform && (
            <span className="text-3xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {platform}
            </span>
          )}
        </div>
      </div>
    </li>
  )
}

export default function WorkdayFeed({ actions = [], compact = false, emptyLabel }) {
  if (!actions.length) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        {emptyLabel || 'Nothing yet — Bernard’s actions will show up here as they happen.'}
      </p>
    )
  }
  return (
    <ul className={compact ? 'space-y-2.5' : 'space-y-3.5'}>
      {actions.map((a) => <FeedRow key={a.id} action={a} compact={compact} />)}
    </ul>
  )
}
