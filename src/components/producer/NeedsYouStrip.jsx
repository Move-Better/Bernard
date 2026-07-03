import { Link } from 'react-router-dom'
import { Pencil, Unplug, Mic, AlertTriangle } from 'lucide-react'
import { useNeedsYou } from '@/lib/queries'

// "Needs you" (Standing Producer Phase 4). Bernard clears what he can on his own
// and surfaces only the dead-ends he can't — each with the one action that
// unblocks it. Sits at the top of /producer. Renders NOTHING when the producer
// is off or there's nothing outstanding, so the page is unchanged for workspaces
// that haven't opted in.
//
// Item shape from /api/producer/needs-you (fields are best-effort — the strip is
// defensive so a partial payload still renders):
//   escalated_caption { contentItemId, platform, topic, score, red_flag }
//   publish_failed    { contentItemId?, platform?, detail }
//   plan_gap          { slot?, topicSuggestion?, week? }

const TYPE_META = {
  escalated_caption: {
    icon: Pencil,
    tone: 'action',
    cta: (item) => ({ to: item.contentItemId ? `/publish/${item.contentItemId}` : '/week', label: 'Open & fix' }),
  },
  publish_failed: {
    icon: Unplug,
    tone: 'destructive',
    cta: () => ({ to: '/settings/integrations', label: 'Reconnect' }),
  },
  plan_gap: {
    icon: Mic,
    tone: 'action',
    cta: () => ({ to: '/new', label: 'Record a topic' }),
  },
}
const FALLBACK_META = { icon: AlertTriangle, tone: 'muted', cta: () => ({ to: '/producer', label: 'Open' }) }

// Per-tone Tailwind classes (design tokens only — no raw hex).
const TONE = {
  action:      { ring: 'border-action/35 bg-action/5',           chip: 'bg-action/15 text-action' },
  destructive: { ring: 'border-destructive/30 bg-destructive/5', chip: 'bg-destructive/10 text-destructive' },
  muted:       { ring: 'border-border bg-card',                  chip: 'bg-muted text-muted-foreground' },
}

function titleFor(item) {
  if (item.title) return item.title
  const topic = item.topic || item.slot || 'a piece'
  switch (item.type) {
    case 'escalated_caption': return `Couldn’t get “${topic}” to your voice`
    case 'publish_failed':    return `${item.platform ? `${item.platform} ` : ''}publish failed — needs a reconnect`
    case 'plan_gap':          return item.topicSuggestion ? `I’m short a topic — got 10 min on ${item.topicSuggestion}?` : 'I’m short a topic for the week'
    default:                  return 'Something needs you'
  }
}

function detailFor(item) {
  if (item.description) return item.description
  switch (item.type) {
    case 'escalated_caption':
      return `I tried a faithfulness pass but couldn’t get it over the voice bar${item.red_flag ? ` — what’s off: ${item.red_flag}` : ''}. It needs your eye.`
    case 'publish_failed':
      return item.detail || 'The connection expired. Reconnect and I’ll dispatch the queued post automatically.'
    case 'plan_gap':
      return 'Your backlog can’t quite fill the week. A short capture from you fills the gap.'
    default:
      return item.detail || ''
  }
}

function NeedsYouRow({ item }) {
  const meta = TYPE_META[item.type] || FALLBACK_META
  const tone = TONE[meta.tone] || TONE.muted
  const Icon = meta.icon
  const cta = meta.cta(item)
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 ${tone.ring}`}>
      <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tone.chip}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{titleFor(item)}</p>
        {detailFor(item) && (
          <p className="mt-0.5 text-xs text-muted-foreground">{detailFor(item)}</p>
        )}
      </div>
      <Link
        to={cta.to}
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {cta.label}
      </Link>
    </div>
  )
}

export default function NeedsYouStrip() {
  const { data } = useNeedsYou()
  if (!data?.enabled) return null
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-action" aria-hidden="true" />
        <h2 className="text-sm font-bold">Needs you</h2>
        <span className="inline-flex items-center rounded-full bg-action/15 px-2 py-0.5 text-2xs font-bold text-action">
          {items.length}
        </span>
        <span className="ml-auto text-2xs text-muted-foreground">Bernard handled the rest</span>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <NeedsYouRow key={item.id || `${item.type}-${item.contentItemId || i}`} item={item} />
        ))}
      </div>
    </div>
  )
}
