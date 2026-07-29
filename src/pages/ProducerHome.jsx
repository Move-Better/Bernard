// ProducerHome — the / landing for permission_tier ∈ {producer, owner}.
//
// 2026-07-29 planning session; see .claude/decisions.md same date and
// .claude/mockups/producer-home.html for the signed-off spec. Replaces the
// clinician-shaped Home for operators: an AI content-production platform
// changes fast, and the producer's job — approving/publishing/monitoring —
// was previously buried as a comma-separated line inside Home's attention
// strip. This page names every checkpoint the producer is the gate for, in
// ranked order, and keeps clinical-judgment checkpoints (answers, words
// approval, memory updates) OFF their queue — those route to the owning
// clinician, per Q's 2026-07-29 mockup feedback.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorState from '@/components/ErrorState'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import CoachingCard from '@/components/producer-home/CoachingCard'
import UpdatesFeed from '@/components/producer-home/UpdatesFeed'

function tierClass(tier) {
  if (tier <= 1) return 'border-destructive/40 bg-destructive/5'
  if (tier === 2) return 'border-action/40 bg-action/5'
  return 'border-border bg-card'
}

function tierRankClass(tier) {
  if (tier <= 2) return 'bg-action text-action-foreground'
  return 'bg-muted text-muted-foreground'
}

function QueueSkeleton() {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true">
      <span className="sr-only">Loading your queue…</span>
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
    </div>
  )
}

function QueueCard({ item, rank }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${tierClass(item.tier)}`}>
      <span className={`shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${tierRankClass(item.tier)}`}>
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
        <p className="mt-0.5 text-sm text-muted-foreground max-w-[64ch]">{item.why}</p>
        <p className={`mt-1 text-xs font-semibold ${item.tier <= 2 ? 'text-action' : 'text-primary'}`}>{item.gate}</p>
      </div>
      <Link
        to={item.ctaHref}
        className="shrink-0 self-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {item.ctaLabel}
      </Link>
    </div>
  )
}

function LedgerGroup({ title, items }) {
  return (
    <div>
      <div className="text-2xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">{title}</div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {items.map((it) => (
          <div
            key={it.type}
            className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
              it.count > 0 ? 'border-action/30 bg-action/5' : 'border-border text-muted-foreground'
            }`}
          >
            <span className="truncate">{it.label}</span>
            <span className="font-bold tabular-nums">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HealthCell({ ch }) {
  const pill = ch.status === 'stalled'
    ? 'bg-destructive/10 text-destructive'
    : ch.status === 'lagging'
      ? 'bg-action/10 text-action'
      : ch.status === 'unknown'
        ? 'bg-muted text-muted-foreground'
        : 'bg-success/10 text-success'
  const label = ch.status === 'stalled' ? 'stalled' : ch.status === 'lagging' ? 'lagging' : ch.status === 'unknown' ? 'no data' : 'on pace'
  return (
    <div className="rounded-md border border-border bg-card px-2.5 py-2 text-xs">
      <div className="text-muted-foreground capitalize">{ch.platform}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-bold tabular-nums">
        {ch.daysIdle == null ? '—' : `${ch.daysIdle}d`}
        <span className={`rounded-full px-1.5 py-0.5 text-2xs font-bold ${pill}`}>{label}</span>
      </div>
    </div>
  )
}

export default function ProducerHome() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const ws = useWorkspace()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['producer-checkpoints'],
    queryFn: () => apiFetch('/api/producer/checkpoints'),
    staleTime: 60_000,
  })

  const greeting = greetingFor(user, ws)
  const queue = data?.queue || []
  const ledger = data?.ledger || { yours: [], clinicians: [] }
  const waiting = data?.waitingOnClinicians || []
  const channels = data?.health?.channels || []

  if (error) {
    return <ErrorState message="Couldn't load your queue." onRetry={refetch} />
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">{greeting}</h1>
        {!isLoading && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {queue.length > 0
              ? `You're the gate for ${queue.length} thing${queue.length === 1 ? '' : 's'} today — here they are, in order.`
              : 'Nothing is waiting on you right now.'}
            {waiting.length > 0 && ` Your clinicians are sitting on ${waiting.reduce((s, w) => s + w.answersToReview + w.wordsApprovals + w.blogDrafts + w.supersessions, 0)} more.`}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Your queue</h2>
        {isLoading ? <QueueSkeleton /> : (
          queue.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Your queue is clear. Nothing needs a decision from you right now.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {queue.map((item, i) => <QueueCard key={item.type} item={item} rank={i + 1} />)}
            </div>
          )
        )}

        {!isLoading && waiting.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {waiting.map((w) => {
              const total = w.answersToReview + w.wordsApprovals + w.blogDrafts + w.supersessions
              const parts = []
              if (w.answersToReview) parts.push(`${w.answersToReview} drafted answer${w.answersToReview === 1 ? '' : 's'}`)
              if (w.wordsApprovals) parts.push(`${w.wordsApprovals} words approval${w.wordsApprovals === 1 ? '' : 's'}`)
              if (w.blogDrafts) parts.push(`${w.blogDrafts} blog draft${w.blogDrafts === 1 ? '' : 's'}`)
              if (w.supersessions) parts.push(`${w.supersessions} memory update${w.supersessions === 1 ? '' : 's'}`)
              return (
                <div key={w.staffId} className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                  <span>Waiting on your clinicians:</span>
                  <span><span className="font-semibold text-foreground">{w.name}</span> has {parts.join(', ')} to review</span>
                  {total > 0 && (
                    <span className="ml-auto shrink-0 text-xs font-semibold text-muted-foreground">
                      not on your queue — that&rsquo;s their call
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {!isLoading && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">All checkpoints</h2>
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
            <LedgerGroup title="Yours" items={ledger.yours} />
            <LedgerGroup title="Your clinicians'" items={ledger.clinicians} />
          </div>
        </section>
      )}

      {!isLoading && channels.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Pipeline &amp; channel health</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5">
            {channels.map((ch) => <HealthCell key={ch.platform} ch={ch} />)}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CoachingCard />
        <UpdatesFeed />
      </div>
    </div>
  )
}
