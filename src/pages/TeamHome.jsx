// TeamHome — the / landing for a team member (permission_tier clinician or
// viewer). Q, 2026-11-09 (.claude/decisions.md "One screen per role"; mockup
// .claude/mockups/role-screens/Clinician.dc.html): two jobs on one screen.
//   1. Start (or continue) your weekly call.
//   2. Waiting on your OK — only things from your OWN interviews that only you
//      can approve: blogs first, then answers and word sign-offs.
// Then Make a point underneath. No clinic-wide rows (other people's posts to
// review or publish) and no "who is overdue" list: those are the producer's
// and the owner's.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { useStories, useStaffSummaries } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { restockNudgeState } from '@/lib/onHand'
import { ownApprovalItems } from '@/lib/ownApprovals'
import PageHelp from '@/components/PageHelp'
import WeeklyCallHero from '@/components/home/WeeklyCallHero'
import ResumeStrip from '@/components/home/ResumeStrip'
import PointCapture from '@/components/home/PointCapture'
import InstallBanner from '@/components/home/InstallBanner'
import FeedbackResolvedBanner from '@/components/home/FeedbackResolvedBanner'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const KIND_LABEL = { blog: 'Blog', answer: 'Answer', words: 'Words', supersession: 'Update' }

function ApprovalRow({ item }) {
  const primary = item.kind === 'blog'
  return (
    <li className="flex flex-wrap items-center gap-4 px-5 py-4 border-b border-border last:border-b-0">
      <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${primary ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
        {KIND_LABEL[item.kind] || 'Review'}
      </span>
      <div className="min-w-0 flex-1 basis-80">
        <p className="text-base font-semibold text-foreground">{item.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{item.meta}</p>
      </div>
      <Link
        to={item.to}
        className={primary
          ? 'shrink-0 inline-flex items-center min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90'
          : 'shrink-0 inline-flex items-center min-h-11 rounded-lg border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary/5'}
      >
        {item.cta}
      </Link>
    </li>
  )
}

export default function TeamHome() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const ws = useWorkspace()

  const { data: stories = [], isLoading: storiesLoading } = useStories()
  const { data: staff = [], isLoading: staffLoading } = useStaffSummaries()

  const myInterviews = useMemo(
    () => staff.flatMap((c) => (c.interviews || [])
      .map((i) => ({ ...i, staffName: c.name, staffId: c.id })))
      .filter((i) => i.owner_id === user?.id),
    [staff, user],
  )
  const lastOwnCallAt = useMemo(() => {
    const done = myInterviews.filter((i) => i.status === 'completed' && i.updated_at)
    return done.length ? Math.max(...done.map((i) => new Date(i.updated_at).getTime())) : null
  }, [myInterviews])
  const resumeInterviews = useMemo(() => {
    const now = Date.now()
    return myInterviews
      .filter((i) => i.status !== 'completed' && i.session_state != null && i.updated_at
        && now - new Date(i.updated_at).getTime() <= RESUME_WINDOW_MS)
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [myInterviews])

  const { data: onHandSummary } = useQuery({
    queryKey: ['moments-summary'],
    queryFn: () => apiFetch('/api/moments/summary'),
    refetchOnWindowFocus: false,
  })
  const restock = restockNudgeState(onHandSummary)

  // Each source is already scoped server-side to the caller's own staff row.
  const { data: weekData, isLoading: weekLoading } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const { data: answerData, isLoading: answersLoading } = useQuery({
    queryKey: ['answers-review-nudge'],
    queryFn: () => apiFetch('/api/answers'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const { data: clinicalData, isLoading: clinicalLoading } = useQuery({
    queryKey: ['my-clinical-checkpoints'],
    queryFn: () => apiFetch('/api/producer/my-clinical-checkpoints'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const approvals = useMemo(() => ownApprovalItems({
    yourReview: weekData?.yourReview ?? [],
    yourAnswerReview: answerData?.answers ?? [],
    wordsApprovals: clinicalData?.wordsApprovalItems ?? [],
    supersessions: clinicalData?.supersessionItems ?? [],
  }), [weekData, answerData, clinicalData])

  const topicGapCount = useMemo(
    () => getSuggestedTopics(ws, stories.map((s) => s.topic))
      .filter((t) => t.interviewCount === 0 && t.priority !== 'low').length,
    [ws, stories],
  )

  const greeting = greetingFor(user, ws)
  const queueLoading = weekLoading || answersLoading || clinicalLoading
  const n = approvals.length

  return (
    <div className="flex flex-col gap-6">
      <div className="nx-grad-ribbon flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-widest text-primary-foreground/75">Welcome back</p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">{greeting}</h1>
        </div>
        <PageHelp pageKey="home" variant="onGradient" />
      </div>

      {staffLoading ? <Skeleton className="h-40 rounded-xl" /> : (
        resumeInterviews.length > 0
          ? <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} staff={staff} />
          : <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} restock={restock} />
      )}
      {!storiesLoading && topicGapCount > 0 && (
        <p className="-mt-3 text-sm text-muted-foreground">
          Not sure what to talk about?{' '}
          <Link to="/new" className="font-semibold text-primary hover:underline">
            {topicGapCount} topic gap{topicGapCount === 1 ? '' : 's'} found for your patients
          </Link>
        </p>
      )}

      <section aria-labelledby="your-ok" className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-action/20 bg-action/5 px-5 py-4">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Waiting on your OK</span>
          <h2 id="your-ok" className="text-base font-bold text-foreground">
            {queueLoading
              ? 'Checking your interviews…'
              : n === 0
                ? 'Nothing from your interviews needs you right now'
                : `${n} thing${n === 1 ? '' : 's'} from your interviews need${n === 1 ? 's' : ''} you`}
          </h2>
        </div>
        {queueLoading ? (
          <div className="p-5 flex flex-col gap-2" role="status" aria-busy="true">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        ) : n > 0 && (
          <ul>{approvals.map((item) => <ApprovalRow key={item.key} item={item} />)}</ul>
        )}
      </section>

      <PointCapture />
      <InstallBanner />
      <FeedbackResolvedBanner />
    </div>
  )
}
