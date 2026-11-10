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
import { PLATFORM_META } from '@/lib/contentMeta'
import CoachingCard from '@/components/producer-home/CoachingCard'
import { useSelfStaffId } from '@/lib/useSelfStaffId'
import { ownApprovalItems, ownApprovalSummary } from '@/lib/ownApprovals'
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

// A producer who also gives interviews (Aj) used to see their own blog drafts
// and word sign-offs only as "waiting on your clinicians, not on your queue",
// a dead end when the clinician is you. Q, 2026-11-09: a producer or owner
// with their own interviews sees their own approvals as theirs, in one row.
function OwnApprovalsRow({ items }) {
  if (!items.length) return null
  const first = items[0]
  return (
    <section aria-labelledby="own-approvals" className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="min-w-0 flex-1 basis-96">
        <h2 id="own-approvals" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">From your own interviews</h2>
        <p className="mt-0.5 text-sm font-semibold text-foreground">{ownApprovalSummary(items)} your OK</p>
        <p className="mt-0.5 text-sm text-muted-foreground max-w-[64ch]">
          These came from interviews you gave, so only you can approve them. First up: &ldquo;{first.title}&rdquo;.
        </p>
      </div>
      <Link
        to={first.to}
        className="shrink-0 inline-flex items-center min-h-11 rounded-md border border-primary bg-card px-3 text-xs font-semibold text-primary hover:bg-primary/10"
      >
        Review yours
      </Link>
    </section>
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

// The tile used to print the raw key, so Google Business read "Gbp" here and
// nowhere else (audit 2026-11-09). Blog stays "Blog": it names a channel, and
// PLATFORM_META's "Blog Post" names a piece.
export function channelName(platform) {
  if (platform === 'blog') return 'Blog'
  return PLATFORM_META[platform]?.label || platform
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
      <div className="text-muted-foreground capitalize">{channelName(ch.platform)}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-bold tabular-nums">
        {ch.daysIdle == null ? '—' : `${ch.daysIdle}d`}
        <span className={`rounded-full px-1.5 py-0.5 text-2xs font-bold ${pill}`}>{label}</span>
      </div>
    </div>
  )
}

// `embedded`: true when rendered as a section inside CombinedHome (an
// owner who is ALSO a clinician — see .claude/decisions.md 2026-07-29
// "combined owner home"). Suppresses the standalone page greeting in favor
// of a section label, since CombinedHome owns the single page-level
// greeting.
export default function ProducerHome({ embedded = false }) {
  useDocumentTitle('Home')
  const { user } = useUser()
  const ws = useWorkspace()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['producer-checkpoints'],
    queryFn: () => apiFetch('/api/producer/checkpoints'),
    staleTime: 60_000,
  })

  const selfStaffId = useSelfStaffId()

  // Own approvals: the same three already-own-scoped sources TeamHome reads
  // (shared query keys, so CombinedHome pays for them once). Not fetched when
  // embedded: CombinedHome's practice section below already lists them.
  const ownEnabled = !embedded && !!selfStaffId
  const { data: weekData } = useQuery({
    queryKey: ['week-summary'], queryFn: () => apiFetch('/api/content-plan/week-summary'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: ownEnabled,
  })
  const { data: answerData } = useQuery({
    queryKey: ['answers-review-nudge'], queryFn: () => apiFetch('/api/answers'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: ownEnabled,
  })
  const { data: clinicalData } = useQuery({
    queryKey: ['my-clinical-checkpoints'], queryFn: () => apiFetch('/api/producer/my-clinical-checkpoints'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: ownEnabled,
  })
  const ownItems = ownEnabled ? ownApprovalItems({
    yourReview: weekData?.yourReview ?? [],
    yourAnswerReview: answerData?.answers ?? [],
    wordsApprovals: clinicalData?.wordsApprovalItems ?? [],
    supersessions: clinicalData?.supersessionItems ?? [],
  }) : []

  const greeting = greetingFor(user, ws)
  const queue = data?.queue || []
  const ledger = data?.ledger || { yours: [], clinicians: [] }
  // Your own pending work is not "waiting on your clinicians" — it is yours
  // (the row above when standalone, the practice section when embedded).
  const waiting = (data?.waitingOnClinicians || []).filter((w) => !selfStaffId || w.staffId !== selfStaffId)
  const channels = data?.health?.channels || []

  // Honest headline (Q, 2026-08-11). This line used to count CARDS — "you're
  // the gate for 5 things today" — while one of those cards held 157 proposed
  // clips, so it understated the real workload by an order of magnitude and
  // read as contradicting Home's card, which counts individual items.
  //
  // `decisions` and `backlog` are computed server-side in
  // /api/producer/checkpoints, where the tier definitions live, so this line
  // and the ranking can never drift apart. A stale cached payload without
  // `summary` falls back to the old card count rather than rendering NaN.
  const summary = data?.summary
  const decisions = summary ? summary.decisions : queue.length
  const backlog = summary ? summary.backlog : 0
  const headline = decisions > 0
    ? `You're the gate for ${decisions} thing${decisions === 1 ? '' : 's'} today — here they are, in order.`
    : backlog > 0
      // Tier-4 cards say in their own words that nothing is blocked by them,
      // so a backlog-only queue is genuinely "nothing blocking", not "clear".
      ? 'Nothing is blocking publishing right now.'
      : 'Nothing is waiting on you right now.'

  if (error) {
    return <ErrorState message="Couldn't load your queue." onRetry={refetch} />
  }

  return (
    <div className={embedded ? 'flex flex-col gap-6' : 'flex flex-col gap-6 py-6'}>
      <div>
        {embedded ? (
          // Name the hat. CombinedHome stacks this queue above Home's practice
          // card, and without saying which role each section speaks to, two
          // lists of work on one page read as one list that disagrees with
          // itself (Q, 2026-08-11).
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Your queue <span className="text-muted-foreground/70">· as the producer</span>
          </h2>
        ) : (
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">{greeting}</h1>
        )}
        {!isLoading && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {headline}
            {backlog > 0 && ` A further ${backlog} sit in the backlog below.`}
            {waiting.length > 0 && ` Your clinicians are sitting on ${waiting.reduce((s, w) => s + w.answersToReview + w.wordsApprovals + w.blogDrafts + w.supersessions, 0)} more.`}
          </p>
        )}
      </div>

      <section>
        {!embedded && <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Your queue</h2>}
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

        {!isLoading && ownItems.length > 0 && <div className="mt-3"><OwnApprovalsRow items={ownItems} /></div>}

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

      {/* The learning panel and the check-in card used to sit here. Both moved
          to /analytics (Q, 2026-07-30): this page answers "what do I need to
          do", and two standing data cards competed with the queue that IS the
          work — against the P5 finding that the bottleneck is reviewer
          ATTENTION. The check-in still reaches the owner, but as a DUE
          checkpoint in the queue above (type: 'learning_checkin') rather than a
          card that is always present. */}

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
