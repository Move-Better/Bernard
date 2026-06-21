import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Loader2, RefreshCw, ChevronRight, Mic2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import LoadingState from '@/components/LoadingState'
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

  const attentionParts = useMemo(() => {
    const parts = []
    if (readyForContent.length > 0) parts.push(`${readyForContent.length} to draft`)
    if (reviewCount > 0) parts.push(`${reviewCount} to review`)
    if (readyToDistribute.length > 0) parts.push(`${readyToDistribute.length} to publish`)
    if (overdueCount > 0) parts.push(`${overdueCount} overdue`)
    return parts
  }, [readyForContent, reviewCount, readyToDistribute, overdueCount])

  const attentionTotal = readyForContent.length + reviewCount + readyToDistribute.length + overdueCount

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

  if (isLoading) return <LoadingState />

  if (storiesError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-sm text-destructive mb-2">Failed to load data</p>
        <p className="text-xs text-muted-foreground mb-4">{storiesError.message}</p>
        <Button size="sm" variant="outline" onClick={() => refetchStories()} disabled={isRefetchingStories}>
          {isRefetchingStories ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Retry
        </Button>
      </div>
    )
  }

  const greeting = greetingFor(user, runtimeWorkspace)

  // WeeklyCallHero is the primary front door for realtime-voice workspaces;
  // the ribbon CTA is hidden so the hero owns the single capture action.
  const callFirst = runtimeWorkspace?.realtime_voice_enabled === true

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting ribbon — personality + single interview CTA */}
      <div className="nx-grad-ribbon flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-widest opacity-85">
            Welcome back
          </p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">{greeting}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <PageHelp pageKey="home" variant="onGradient" />
          {!callFirst && (
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

      {/* Call-first hero — only for realtime-voice workspaces. */}
      {callFirst && <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} />}

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
          className="flex items-center gap-3 rounded-xl border border-action/30 bg-action/5 px-4 py-3 hover:bg-action/10 transition-colors"
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

      {/* Compact attention strip — replaces expanded task-bucket sections.
          Detail lives in Overview; this is just the count + a link. */}
      {attentionTotal > 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{ background: 'hsl(var(--action) / 0.08)', border: '1px solid hsl(var(--action) / 0.25)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-2 w-2 rounded-full bg-action shrink-0" />
            <span className="text-sm font-medium text-foreground">
              {attentionTotal} {attentionTotal === 1 ? 'item needs' : 'items need'} your attention
            </span>
            {attentionParts.length > 0 && (
              <span className="hidden sm:inline text-xs text-muted-foreground">
                · {attentionParts.join(' · ')}
              </span>
            )}
          </div>
          <Link
            to="/overview"
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5 shrink-0"
          >
            See all in Overview <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
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
