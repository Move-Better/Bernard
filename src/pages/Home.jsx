import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Loader2, RefreshCw, ChevronRight, Mic2, AlertTriangle } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useStories, useStaffSummaries } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import GettingStarted from '@/components/home/GettingStarted'
import WeeklyCallHero from '@/components/home/WeeklyCallHero'
import OnboardingCard from '@/components/home/OnboardingCard'
import HomeStats from '@/components/home/HomeStats'
import ResumeStrip from '@/components/home/ResumeStrip'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import PostsLiveCard from '@/components/home/PostsLiveCard'
import PageHelp from '@/components/PageHelp'
import InstallBanner from '@/components/home/InstallBanner'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// Greeting ribbon — depends only on user + workspace (not the stories/staff
// queries), so it renders immediately, including during load.
function GreetingRibbon({ greeting, callFirst, hasResume }) {
  return (
    <div className="nx-grad-ribbon flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">{greeting}</h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <PageHelp pageKey="home" variant="onGradient" />
        {!callFirst && !hasResume && (
          <Link
            to="/new"
            className="inline-flex items-center gap-2 bg-background text-foreground font-semibold px-4 py-2 rounded-lg shadow hover:bg-muted text-sm"
          >
            <Mic2 className="h-4 w-4" aria-hidden="true" />
            Start your weekly call
          </Link>
        )}
      </div>
    </div>
  )
}

// Loading skeleton — shows the real ribbon immediately, then content-shaped
// placeholders for the data-dependent sections, instead of a blank spinner.
function HomeSkeleton({ greeting, callFirst }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your home…</span>
      <GreetingRibbon greeting={greeting} callFirst={callFirst} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

export default function Home() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const { canReview, isEditor } = useUserRole()
  const runtimeWorkspace = useWorkspace()

  // Stories (interviews + content pieces merged)
  const { data: stories = [], isLoading: storiesLoading, error: storiesError, refetch: refetchStories, isFetching: isRefetchingStories } = useStories()

  // Slim clinician summaries — includes session_state for the resume strip.
  const { data: staff = [], isLoading: staffLoading } = useStaffSummaries()

  // Derived data from stories
  const allInterviews = useMemo(
    () =>
      staff.flatMap((c) =>
        (c.interviews || []).map((i) => ({ ...i, staffName: c.name, staffId: c.id }))
      ),
    [staff]
  )

  // Most recent completed interview for this user — drives the "N days since
  // your last call" nudge in WeeklyCallHero.
  const lastOwnCallAt = useMemo(() => {
    const mine = allInterviews.filter(
      (i) => i.status === 'completed' && i.owner_id === user?.id && i.updated_at
    )
    if (mine.length === 0) return null
    return mine.reduce((max, i) => Math.max(max, new Date(i.updated_at).getTime()), 0)
  }, [allInterviews, user])

  const resumeInterviews = useMemo(() => {
    const now = Date.now()
    return allInterviews
      .filter(
        (i) =>
          i.status !== 'completed' &&
          i.session_state != null &&
          i.updated_at &&
          now - new Date(i.updated_at).getTime() <= RESUME_WINDOW_MS &&
          i.owner_id === user?.id
      )
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [allInterviews, user])

  // Derive from stories (already loaded) — each story maps 1:1 to an interview
  const existingTopics = useMemo(
    () => stories.map((s) => s.topic),
    [stories]
  )

  const [topicFilterPrototype, setTopicFilterPrototype] = useState(null)
  const prototypesUi = useMemo(
    () => getPatientPrototypesUi(runtimeWorkspace),
    [runtimeWorkspace]
  )
  const unfilteredGaps = useMemo(
    () =>
      getSuggestedTopics(runtimeWorkspace, existingTopics)
        .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
        .slice(0, 8),
    [existingTopics, runtimeWorkspace]
  )
  const topicGaps = useMemo(
    () =>
      getSuggestedTopics(runtimeWorkspace, existingTopics, topicFilterPrototype)
        .filter((t) => t.interviewCount === 0 && t.priority !== 'low')
        .slice(0, 8),
    [existingTopics, runtimeWorkspace, topicFilterPrototype]
  )

  // ── Attention strip counts ──────────────────────────────────────────────────
  const readyForContent = useMemo(
    () => stories.filter((s) => s.story_stage === 'drafting' && (s.pieces_count || 0) === 0),
    [stories]
  )
  const reviewCount = useMemo(
    () => (canReview ? stories.filter((s) => s.story_stage === 'review').length : 0),
    [stories, canReview]
  )
  const readyToDistribute = useMemo(
    () => (isEditor ? stories.filter((s) => (s.pieces_by_status?.approved ?? 0) > 0) : []),
    [stories, isEditor]
  )
  const overdueCount = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return staff.filter((c) => {
      const interviews = c.interviews || []
      if (interviews.length === 0) return true
      const mostRecent = interviews.reduce((latest, i) => {
        const t = new Date(i.updated_at || i.created_at || 0).getTime()
        return t > latest ? t : latest
      }, 0)
      return mostRecent < thirtyDaysAgo
    }).length
  }, [staff])

  // Each part links to where its detail actually lives, so the strip is a real
  // jump-list rather than a count that dead-ends on a page that doesn't show it.
  const attentionParts = useMemo(() => {
    const parts = []
    if (readyForContent.length > 0) parts.push({ label: `${readyForContent.length} to draft`, to: '/stories?stage=drafting' })
    if (reviewCount > 0) parts.push({ label: `${reviewCount} to review`, to: '/stories?stage=review' })
    if (readyToDistribute.length > 0) parts.push({ label: `${readyToDistribute.length} to publish`, to: '/publish' })
    if (overdueCount > 0) parts.push({ label: `${overdueCount} overdue`, to: '/overview', urgent: true })
    return parts
  }, [readyForContent, reviewCount, readyToDistribute, overdueCount])

  const attentionTotal = readyForContent.length + reviewCount + readyToDistribute.length + overdueCount

  // Failed posts — a publish bundle.social rejected. A distribution concern, so
  // it's gated to editors like readyToDistribute. Surfaced as its OWN banner
  // (below) rather than folded into the attention strip: a dead post is more
  // urgent than a to-do and must not get buried in the comma list.
  const failedPieces = useMemo(
    () => (isEditor ? stories.flatMap((s) => (s.pieces || []).filter((p) => p.status === 'failed')) : []),
    [stories, isEditor]
  )

  // Blog review nudge — clinicians who opted in and have posts awaiting their read
  const { data: weekData } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    enabled: !isEditor,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const yourReview = weekData?.yourReview || []

  const isLoading = storiesLoading || staffLoading

  const greeting = greetingFor(user, runtimeWorkspace)
  // WeeklyCallHero is the primary front door for realtime-voice workspaces;
  // the ribbon CTA is hidden so the hero owns the single capture action.
  const callFirst = runtimeWorkspace?.realtime_voice_enabled === true

  if (isLoading) return <HomeSkeleton greeting={greeting} callFirst={callFirst} />

  if (storiesError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-destructive mb-2">Failed to load data</p>
        <p className="text-xs text-muted-foreground mb-4">{storiesError.message}</p>
        <Button size="sm" variant="outline" onClick={() => refetchStories()} disabled={isRefetchingStories}>
          {isRefetchingStories ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting ribbon — personality + single interview CTA */}
      <GreetingRibbon greeting={greeting} callFirst={callFirst} hasResume={resumeInterviews.length > 0} />

      {/* Call-first hero — only for realtime-voice workspaces. */}
      {callFirst && <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} />}

      {/* Failed-publish alert — a post bundle.social rejected. Rendered above the
          amber attention strip because a dead post is more urgent than a to-do and
          must not get buried in the comma list. Links straight to the failed
          piece (single) so the fix is one click away. */}
      {failedPieces.length > 0 && (
        <Link
          to={failedPieces.length === 1 ? `/publish/${failedPieces[0].id}` : '/stories'}
          className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 hover:brightness-[0.98] transition"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive/15 text-destructive shrink-0">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <span className="text-sm font-medium text-foreground">
            {failedPieces.length} {failedPieces.length === 1 ? 'post' : 'posts'} failed to publish
          </span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-sm font-medium text-destructive">
            Review <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      )}

      {/* Compact attention strip — work before reward: the queue sits directly
          under the greeting so pending items are seen before the celebratory
          cards below. Detail lives in Overview; this is just the count + a link. */}
      {attentionTotal > 0 && (
        <div
          className="flex items-center gap-x-3 gap-y-1.5 rounded-xl border border-action/25 bg-action/8 px-4 py-3 flex-wrap"
        >
          <span className="h-2 w-2 rounded-full bg-action shrink-0" />
          <span className="text-sm font-medium text-foreground">
            {attentionTotal} {attentionTotal === 1 ? 'item needs' : 'items need'} your attention
          </span>
          {attentionParts.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
              {attentionParts.map((part) => (
                <span key={part.to} className="flex items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <Link
                    to={part.to}
                    className={`font-medium transition-colors inline-flex items-center gap-0.5 ${part.urgent ? 'text-destructive hover:text-destructive/80' : 'text-primary hover:text-primary/80'}`}
                  >
                    {part.label} <ChevronRight className="h-3 w-3" />
                  </Link>
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      <InstallBanner />

      {/* Reward — pieces that went live this week. Reinforces "you talked → published." */}
      <PostsLiveCard stories={stories} userId={user?.id} />

      {/* Finish onboarding if needed — self-gated, renders nothing for the 99% case. */}
      <OnboardingCard />

      {/* Resume in-progress interview if one exists within the last 14 days. */}
      {resumeInterviews.length > 0 && (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} staff={staff} />
      )}

      {/* Pipeline story: interviews captured → voice match → published */}
      {stories.length > 0 && <HomeStats stories={stories} />}

      {/* Blog review nudge — compact inline link for clinicians with opted-in
          blog review who have posts waiting on /week. */}
      {!isEditor && yourReview.length > 0 && (
        <Link
          to="/week"
          className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3 hover:bg-muted/80 transition-colors"
        >
          <BookOpen className="h-4 w-4 text-action shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {yourReview.length === 1
                ? 'Your blog post is ready to review'
                : `${yourReview.length} blog posts ready for your review`}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {yourReview[0]?.topic}
              {yourReview.length > 1 ? ` +${yourReview.length - 1} more` : ''}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* What to talk about next (merged: patient question gaps + topic planner)
          Falls back to GettingStarted for brand-new workspaces. */}
      {unfilteredGaps.length > 0 && stories.length > 0 ? (
        <PlanNextInterview
          gaps={topicGaps}
          isEmpty={allInterviews.length === 0}
          prototypes={prototypesUi}
          activePrototypeId={topicFilterPrototype}
          onPrototypeChange={setTopicFilterPrototype}
        />
      ) : (
        <GettingStarted />
      )}
    </div>
  )
}
