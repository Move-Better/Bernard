import { Link } from 'react-router-dom'
import { Pencil, Unplug, Mic, AlertTriangle, Video } from 'lucide-react'
import { useNeedsYou, useRetryPublishFailure } from '@/lib/queries'

// "Needs you" (Standing Producer Phase 4). Bernard clears what he can on his own
// and surfaces only the dead-ends he can't — each with the one action that
// unblocks it. Sits at the top of /producer. Renders NOTHING when the producer
// is off or there's nothing outstanding, so the page is unchanged for workspaces
// that haven't opted in.
//
// Item shape from /api/producer/needs-you (fields are best-effort — the strip is
// defensive so a partial payload still renders):
//   escalated_caption   { contentItemId, platform, topic, score, red_flag }
//   publish_failed      { contentItemId?, platform?, detail }
//   plan_gap            { slot?, topicSuggestion?, week? }
//   draft_request_unmet { topic, platform } — F20: no interview grounds a
//     human-typed draft request (draftOnTopic.js's grounded-only escalation).
//   footage_gap         { short, target, topics: [{topic, why}], week } — T2:
//     the week wants Reels and the clip library can't supply them. The only
//     item here whose fix is off-screen (go film something), so it sorts first.

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
  draft_request_unmet: {
    icon: Mic,
    tone: 'action',
    cta: () => ({ to: '/new', label: 'Record a topic' }),
  },
  footage_gap: {
    icon: Video,
    tone: 'action',
    // Straight to the uploader: the ask is "film this and put it here", and the
    // clip pipeline takes over from the upload on its own.
    cta: () => ({ to: '/library', label: 'Upload footage' }),
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
    case 'plan_gap':          return `Next week is ${item.short || 'a few'} post${item.short === 1 ? '' : 's'} short`
    case 'draft_request_unmet': return `Nothing from the team on “${topic}” yet`
    case 'footage_gap':       return `${item.short || 'A few'} Reel${item.short === 1 ? '' : 's'} this week need footage`
    default:                  return 'Something needs you'
  }
}

function detailFor(item) {
  if (item.description) return item.description
  switch (item.type) {
    case 'escalated_caption':
      return `I tried a faithfulness pass but couldn’t get it over the voice bar${item.redFlag ? ` — what’s off: ${item.redFlag}` : ''}. It needs your eye.`
    case 'publish_failed':
      return item.detail || 'The connection expired. Reconnect, then retry the post.'
    case 'plan_gap':
      return `${typeof item.scheduled === 'number' && typeof item.target === 'number' ? `Your plan fills ${item.scheduled} of ${item.target} slots — ` : ''}a short capture from you fills the rest.`
    case 'draft_request_unmet':
      return `I couldn’t find an interview to ground this in, so I didn’t guess. A quick capture and I’ll draft it properly.`
    case 'footage_gap': {
      // Name real topics when we have them — "film 30s on plantar fasciitis" is
      // a task someone can do today; "record more videos" is easy to ignore.
      const named = (item.topics || []).map((t) => t.topic).filter(Boolean)
      if (named.length) {
        return `I’ve used every clip worth cutting. 30 seconds to camera on ${named.slice(0, 2).join(' or ')} and I’ll cut, caption and draft it for you.`
      }
      return `I’ve used every clip worth cutting. Any short video of you talking and I’ll cut, caption and draft the Reels from it.`
    }
    default:
      return item.detail || ''
  }
}

function NeedsYouRow({ item, onRetry, retryingId }) {
  const meta = TYPE_META[item.type] || FALLBACK_META
  const tone = TONE[meta.tone] || TONE.muted
  const Icon = meta.icon
  const cta = meta.cta(item)
  // Retry re-runs the same publish for this exact content item — only
  // possible when we know which row failed (a small number of failures carry
  // no content_item_id and can't be retried, only reconnected).
  const canRetry = item.type === 'publish_failed' && !!item.contentItemId
  const isRetrying = retryingId === item.contentItemId
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
      <div className="flex shrink-0 items-center gap-2">
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry(item.contentItemId)}
            disabled={isRetrying}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
          >
            {isRetrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <Link
          to={cta.to}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {cta.label}
        </Link>
      </div>
    </div>
  )
}

export default function NeedsYouStrip() {
  const { data } = useNeedsYou()
  const retryPublish = useRetryPublishFailure()
  if (!data?.enabled) return null
  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) return null

  const retryingId = retryPublish.isPending ? retryPublish.variables?.contentItemId : null

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
          <NeedsYouRow
            key={item.id || `${item.type}-${item.contentItemId || i}`}
            item={item}
            onRetry={(contentItemId) => retryPublish.mutate({ contentItemId })}
            retryingId={retryingId}
          />
        ))}
      </div>
    </div>
  )
}
