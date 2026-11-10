// OwnerHome — the / landing for an owner (Q, 2026-11-09; simplicity audit,
// option B; mockup "Owner Home, shorter", signed off the same day).
//
// Replaces CombinedHome, which stacked ProducerHome's queue above the
// clinician Home: 4.8 screens, the same counts printed three times, and a
// second list titled "N things need you" under the first. Now one ranked
// inbox. What sits where is decided in @/lib/ownerInbox (pure, tested); this
// file only fetches and draws.
//
// Moved off this page: the "All checkpoints" grid (it repeated the queue's
// counts), Bernard's weekly coaching note (now on Insights), What's new (its
// own page, /updates) and the stats line. "Posts live" stays: it renders only
// in a week where something of yours went live.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Mic } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorState from '@/components/ErrorState'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useSelfStaffId } from '@/lib/useSelfStaffId'
import { useStaffSummaries, useStories } from '@/lib/queries'
import { greetingFor } from '@/components/home/helpers'
import { buildAttentionItems } from '@/lib/attentionItems'
import { ownApprovalItems } from '@/lib/ownApprovals'
import { buildOwnerInbox, rankTone } from '@/lib/ownerInbox'
import { ViewAsSwitch } from '@/components/ViewAsSwitch'
import PointCapture from '@/components/home/PointCapture'
import ResumeStrip from '@/components/home/ResumeStrip'
import OnboardingCard from '@/components/home/OnboardingCard'
import FeedbackResolvedBanner from '@/components/home/FeedbackResolvedBanner'
import PostsLiveCard from '@/components/home/PostsLiveCard'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const TONE = {
  blocked: { row: 'bg-destructive/5', badge: 'bg-destructive text-destructive-foreground' },
  urgent: { row: '', badge: 'bg-action text-action-foreground' },
  normal: { row: '', badge: 'bg-muted text-muted-foreground' },
}

function InboxRow({ row, n }) {
  const tone = TONE[rankTone(row.rank)]
  return (
    // On a phone the button wraps under the text (indented to line up with it)
    // instead of squeezing the title to a word per line.
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3.5 first:border-t-0 sm:flex-nowrap sm:px-5 ${tone.row}`}>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tone.badge}`}>{n}</span>
      <div className="min-w-0 flex-[1_1_14rem]">
        <h3 className="text-sm font-semibold text-foreground">{row.title}</h3>
        {row.why && <p className="mt-0.5 text-sm text-muted-foreground max-w-[70ch]">{row.why}</p>}
      </div>
      <Link
        to={row.to}
        className="ml-9 inline-flex min-h-10 shrink-0 items-center gap-0.5 rounded-md bg-primary px-3.5 sm:ml-0 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {row.cta} <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </li>
  )
}

function Fold({ summary, children }) {
  return (
    <details className="group border-t border-border">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-accent/40 sm:px-5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span>{summary}</span>
      </summary>
      <div className="px-4 pb-3 pl-10 text-sm text-muted-foreground sm:px-5 sm:pl-11">{children}</div>
    </details>
  )
}

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4" role="status" aria-busy="true">
      <span className="sr-only">Loading what needs you…</span>
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  )
}

export default function OwnerHome() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const ws = useWorkspace()
  const selfStaffId = useSelfStaffId()
  const isClinician = !!selfStaffId

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['producer-checkpoints'],
    queryFn: () => apiFetch('/api/producer/checkpoints'),
    staleTime: 60_000,
  })

  // The owner's own approvals: the same three own-scoped sources TeamHome and
  // ProducerHome read (shared query keys, so React Query fetches them once).
  const { data: weekData } = useQuery({
    queryKey: ['week-summary'], queryFn: () => apiFetch('/api/content-plan/week-summary'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: isClinician,
  })
  const { data: answerData } = useQuery({
    queryKey: ['answers-review-nudge'], queryFn: () => apiFetch('/api/answers'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: isClinician,
  })
  const { data: clinicalData } = useQuery({
    queryKey: ['my-clinical-checkpoints'], queryFn: () => apiFetch('/api/producer/my-clinical-checkpoints'),
    staleTime: 5 * 60_000, refetchOnWindowFocus: false, enabled: isClinician,
  })
  const { data: onHand } = useQuery({
    queryKey: ['moments-summary'], queryFn: () => apiFetch('/api/moments/summary'),
    refetchOnWindowFocus: false, enabled: isClinician,
  })
  const { data: staff = [] } = useStaffSummaries()
  const { data: stories = [] } = useStories()

  const inbox = useMemo(() => {
    const ownItems = isClinician ? ownApprovalItems({
      yourReview: weekData?.yourReview ?? [],
      yourAnswerReview: answerData?.answers ?? [],
      wordsApprovals: clinicalData?.wordsApprovalItems ?? [],
      supersessions: clinicalData?.supersessionItems ?? [],
    }) : []
    const slipping = buildAttentionItems({ staff }).byTier.slipping
    return buildOwnerInbox({ checkpoints: data, ownItems, slipping, selfStaffId })
  }, [isClinician, weekData, answerData, clinicalData, staff, data, selfStaffId])

  const resumeInterviews = useMemo(() => {
    if (!user?.id) return []
    const now = Date.now()
    return staff
      .flatMap((c) => (c.interviews || []).map((i) => ({ ...i, staffName: c.name, staffId: c.id })))
      .filter((i) => i.status !== 'completed' && i.session_state != null && i.updated_at
        && now - new Date(i.updated_at).getTime() <= RESUME_WINDOW_MS && i.owner_id === user.id)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [staff, user])

  const greeting = greetingFor(user, ws)
  const callHref = ws?.realtime_voice_enabled === true ? '/new/live-interview' : '/new'

  if (error) return <ErrorState message="Couldn't load what needs you." onRetry={refetch} />

  return (
    <div className="flex flex-col gap-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">{greeting}</h1>
          {!isLoading && <p className="mt-0.5 text-sm text-muted-foreground">{inbox.headline}</p>}
        </div>
        <ViewAsSwitch />
      </div>

      <OnboardingCard />
      <FeedbackResolvedBanner />

      <div className="flex flex-wrap items-start gap-5">
        <section aria-labelledby="needs-you" className="min-w-0 flex-[999_1_560px] overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3 sm:px-5">
            <h2 id="needs-you" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Needs you{!isLoading && ` · ${inbox.rows.length}`}
            </h2>
            {inbox.channels.length > 0 && (
              <p className={`text-xs font-semibold ${inbox.channelsAlarm ? 'text-destructive' : 'text-muted-foreground'}`}>
                Last posts: {inbox.channels.map((c) => `${c.label} ${c.days}d`).join(' · ')}
              </p>
            )}
          </div>

          {isLoading ? <InboxSkeleton /> : inbox.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground sm:px-5">Nothing needs a decision from you right now.</p>
          ) : (
            <ol className="list-none">
              {inbox.rows.map((row, i) => <InboxRow key={row.key} row={row} n={i + 1} />)}
            </ol>
          )}

          {!isLoading && (inbox.team.length > 0 || inbox.backlog.length > 0 || inbox.slipping.length > 0) && (
            <div className="bg-muted/30">
              {inbox.team.length > 0 && (
                <Fold summary={<><strong className="font-semibold text-foreground">{inbox.teamTotal} with your team</strong> · their call, not yours</>}>
                  <ul className="flex flex-col gap-1.5">
                    {inbox.team.map((w) => (
                      <li key={w.staffId}><strong className="font-semibold text-foreground">{w.name}</strong>: {w.phrase}</li>
                    ))}
                  </ul>
                </Fold>
              )}
              {inbox.backlog.map((b) => (
                <Fold key={b.key} summary={<><strong className="font-semibold text-foreground">{b.title}</strong> · when you have time, nothing waits on it</>}>
                  <Link to={b.to} className="font-semibold">{b.cta}</Link>
                </Fold>
              ))}
              {inbox.slipping.length > 0 && (
                <Fold summary={<><strong className="font-semibold text-foreground">{inbox.slipping.length} {inbox.slipping.length === 1 ? 'person hasn’t' : 'people haven’t'} talked to Bernard</strong> in 30+ days</>}>
                  <ul className="flex flex-col gap-1.5">
                    {inbox.slipping.map((s) => (
                      <li key={s.key} className="flex flex-wrap items-center gap-x-2">
                        <strong className="font-semibold text-foreground">{s.title}</strong>
                        <span>{s.meta}</span>
                        <Link to={s.to} className="font-semibold">{s.cta}</Link>
                      </li>
                    ))}
                  </ul>
                </Fold>
              )}
            </div>
          )}
        </section>

        {isClinician && (
          <aside aria-label="Your own work" className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            {resumeInterviews.length > 0 ? (
              <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} staff={staff} />
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
                <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your weekly call</h2>
                {onHand?.usable > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {onHand.usable} moments on hand
                    {Number.isFinite(onHand.runwayWeeks) && `, about ${Math.floor(onHand.runwayWeeks)} weeks of posts`}.
                  </p>
                )}
                <Link
                  to={callHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Mic className="h-4 w-4" aria-hidden="true" /> Start your weekly call
                </Link>
                <Link to="/new" className="text-xs font-semibold">Type or upload instead</Link>
              </div>
            )}
            <PointCapture />
          </aside>
        )}
      </div>

      <PostsLiveCard stories={stories} userId={user?.id} />

      <p className="text-xs text-muted-foreground">
        Bernard&rsquo;s weekly note and the check-in are on <Link to="/analytics" className="font-semibold">Insights</Link>.
        {' '}<Link to="/updates" className="font-semibold">What&rsquo;s new</Link> has its own page.
      </p>
    </div>
  )
}
