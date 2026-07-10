import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Mic2, AlertTriangle, Inbox } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import ErrorState from '@/components/ErrorState'
import { useStories, useStaffSummaries } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { getSuggestedTopics } from '@/lib/topicSuggestions'
import { getPatientPrototypesUi } from '@/lib/patientPrototypes'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { greetingFor } from '@/components/home/helpers'
import GettingStarted from '@/components/home/GettingStarted'
import WeeklyCallHero from '@/components/home/WeeklyCallHero'
import OnboardingCard, { isSnoozed as isOnboardingSnoozed } from '@/components/home/OnboardingCard'
import HomeStats from '@/components/home/HomeStats'
import ResumeStrip from '@/components/home/ResumeStrip'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import PostsLiveCard from '@/components/home/PostsLiveCard'
import PageHelp from '@/components/PageHelp'
import InstallBanner from '@/components/home/InstallBanner'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// Greeting ribbon — depends only on user + workspace (not the stories/staff
// queries), so it renders immediately, including during load.
function GreetingRibbon({ greeting, callFirst }) {
  return (
    <div className="nx-grad-ribbon flex items-center justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-2xs font-bold uppercase tracking-widest text-primary-foreground/75">
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
  )
}

// Loading skeleton — shows the real ribbon immediately, then content-shaped
// placeholders for the data-dependent sections, instead of a blank spinner.
// Shaped to roughly match the post-hero-cascade layout (one hero-sized block,
// a compact strip, a stats row, a card) rather than undershooting it — a
// short skeleton followed by a much taller real page reads as layout shift
// (2026-07-04 audit finding #14).
function HomeSkeleton({ greeting, callFirst }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your home…</span>
      <GreetingRibbon greeting={greeting} callFirst={callFirst} />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

export default function Home() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const { canReview, isEditor, isOrgAdmin } = useUserRole()
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

  // Blog review nudge — clinicians who opted in and have posts awaiting their read
  const { data: weekData } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    enabled: !isEditor,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const yourReview = weekData?.yourReview || []

  // Answer-review queue — its own fetch (NOT gated on isEditor / week-summary):
  // an editor who is also a clinician owns answers and must see their queue.
  const { data: answerReviewData } = useQuery({
    queryKey: ['answers-review-nudge'],
    queryFn: () => apiFetch('/api/answers'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const yourAnswerReview = answerReviewData?.answers || []

  // Each part links to where its detail actually lives, so the strip is a real
  // jump-list rather than a count that dead-ends on a page that doesn't show it.
  // Blog-review and answer-review nudges fold in here too — they're structurally
  // identical to the other parts ("N items need review, link to X") and don't
  // warrant their own full-width card (2026-07-03 audit: too many stacked amber
  // surfaces dilute the "act now" signal).
  const attentionParts = useMemo(() => {
    const parts = []
    if (readyForContent.length > 0) parts.push({ label: `${readyForContent.length} to draft`, to: '/stories?stage=drafting' })
    if (reviewCount > 0) parts.push({ label: `${reviewCount} to review`, to: '/stories?stage=review' })
    if (readyToDistribute.length > 0) parts.push({ label: `${readyToDistribute.length} to publish`, to: '/publish' })
    if (yourReview.length > 0) parts.push({ label: `${yourReview.length} blog to review`, to: '/week' })
    if (yourAnswerReview.length > 0) parts.push({ label: `${yourAnswerReview.length} answers to review`, to: '/answers-review' })
    if (overdueCount > 0) parts.push({ label: `${overdueCount} overdue`, to: '/new', urgent: true })
    return parts
  }, [readyForContent, reviewCount, readyToDistribute, yourReview.length, yourAnswerReview.length, overdueCount])

  const attentionTotal =
    readyForContent.length +
    reviewCount +
    readyToDistribute.length +
    yourReview.length +
    yourAnswerReview.length +
    overdueCount

  // Failed posts — a publish bundle.social rejected. A distribution concern, so
  // it's gated to editors like readyToDistribute. Surfaced as its OWN banner
  // (below) rather than folded into the attention strip: a dead post is more
  // urgent than a to-do and must not get buried in the comma list.
  const failedPieces = useMemo(
    () => (isEditor ? stories.flatMap((s) => (s.pieces || []).filter((p) => p.status === 'failed')) : []),
    [stories, isEditor]
  )

  const isLoading = storiesLoading || staffLoading

  const greeting = greetingFor(user, runtimeWorkspace)
  // WeeklyCallHero is the primary front door for realtime-voice workspaces;
  // the ribbon CTA is hidden so the hero owns the single capture action.
  const callFirst = runtimeWorkspace?.realtime_voice_enabled === true

  // ── Hero cascade (2026-07-04 P0 audit fix) ──────────────────────────────
  // Exactly one "primary surface" renders per lifecycle state, in priority
  // order, so the page reads as "here's the one thing that matters" instead
  // of stacking every card that COULD be relevant. Lower-priority surfaces
  // either hide (when they'd be redundant with the active hero) or collapse
  // to a compact one-line row via each component's `compact` prop.
  //   onboarding — admin hasn't finished the founder interview yet (mirrors
  //     OnboardingCard's own visibility gate, minus the async interview
  //     fetch, so this can be computed synchronously here)
  //   resume     — an in-progress interview is pickup-able
  //   call       — realtime-voice workspaces default to the weekly-call hero
  // OnboardingCard tells us if it's actually going to render nothing despite
  // the sync prediction below saying "pending" — the synthesized-but-flag-
  // not-yet-set race window (see OnboardingCard.jsx). Defaults to true so we
  // don't flash resume/call before the card's own fetch has resolved.
  const [onboardingCardWouldRender, setOnboardingCardWouldRender] = useState(true)
  const handleOnboardingVisibility = useCallback((visible) => setOnboardingCardWouldRender(visible), [])

  const onboardingPending =
    !!runtimeWorkspace?.id &&
    isOrgAdmin &&
    !runtimeWorkspace.onboarding_interview_completed_at &&
    !isOnboardingSnoozed(runtimeWorkspace.id) &&
    onboardingCardWouldRender
  const heroState = onboardingPending
    ? 'onboarding'
    : resumeInterviews.length > 0
      ? 'resume'
      : callFirst
        ? 'call'
        : 'none'
  // Progressive disclosure: whenever the top of the page has something that
  // needs the user — a hero (call/resume/onboarding) OR pending attention items
  // — collapse the stat/summary rows (pipeline stats, "what to talk about next")
  // to their one-line compact form with an expander, so Home leads with the
  // 1–2 things to act on instead of a stack of full-size cards. With nothing
  // urgent and no hero, the fuller view is fine (there's nothing to lead over).
  const secondaryCompact = heroState !== 'none' || attentionTotal > 0

  if (isLoading) return <HomeSkeleton greeting={greeting} callFirst={callFirst} />

  if (storiesError) {
    return (
      <ErrorState
        message="Failed to load data"
        detail={storiesError.message}
        onRetry={() => refetchStories()}
        retrying={isRefetchingStories}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting ribbon — personality + single interview CTA */}
      <GreetingRibbon greeting={greeting} callFirst={callFirst} />

      {/* Call-first hero — only when it's the winning primary surface (see
          heroState above). Suppressed when onboarding or an in-progress
          interview already owns the "start/continue a call" action, so the
          CTA doesn't appear twice. */}
      {heroState === 'call' && <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} />}

      {/* Failed-publish alert — a post bundle.social rejected. Rendered above the
          amber attention strip because a dead post is more urgent than a to-do and
          must not get buried in the comma list. Links straight to the failed
          piece (single) so the fix is one click away; multiple failures land on
          Stories pre-filtered to status=failed so it isn't a needle-in-a-haystack
          hunt through the full list. */}
      {failedPieces.length > 0 && (
        <Link
          to={failedPieces.length === 1 ? `/publish/${failedPieces[0].id}` : '/stories?status=failed'}
          className="nx-alert nx-alert-crit hover:brightness-[0.98] transition"
        >
          <span className="nx-alert-chip nx-alert-chip-crit">
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
          className="nx-alert nx-alert-act gap-x-3 gap-y-1.5 flex-wrap"
        >
          <span className="nx-alert-chip nx-alert-chip-act">
            <Inbox className="h-4 w-4" />
          </span>
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
                    {part.urgent && <Mic2 className="h-3 w-3" aria-hidden="true" />}
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
      <OnboardingCard onVisibilityChange={handleOnboardingVisibility} />

      {/* Resume in-progress interview — the winning hero when heroState is
          'resume'. Otherwise stays hidden (WeeklyCallHero already lost the
          cascade to onboarding in that branch, so there's no redundant case
          to worry about here). */}
      {heroState === 'resume' && (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} staff={staff} />
      )}

      {/* Pipeline story: interviews captured → voice match → published.
          Collapses to a one-line row once a hero card above already owns
          primary attention. */}
      {stories.length > 0 && <HomeStats stories={stories} compact={secondaryCompact} />}

      {/* What to talk about next (merged: patient question gaps + topic planner)
          Falls back to GettingStarted for brand-new workspaces. Both collapse
          to a one-line row once a hero card above already owns primary
          attention. */}
      {unfilteredGaps.length > 0 && stories.length > 0 ? (
        <PlanNextInterview
          gaps={topicGaps}
          isEmpty={allInterviews.length === 0}
          prototypes={prototypesUi}
          activePrototypeId={topicFilterPrototype}
          onPrototypeChange={setTopicFilterPrototype}
          compact={secondaryCompact}
        />
      ) : (
        <GettingStarted compact={secondaryCompact} />
      )}
    </div>
  )
}
