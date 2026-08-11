import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { Mic2 } from 'lucide-react'
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
import { restockNudgeState } from '@/lib/onHand'
import GettingStarted from '@/components/home/GettingStarted'
import WeeklyCallHero from '@/components/home/WeeklyCallHero'
import OnboardingCard, { isSnoozed as isOnboardingSnoozed } from '@/components/home/OnboardingCard'
import HomeStats from '@/components/home/HomeStats'
import ResumeStrip from '@/components/home/ResumeStrip'
import PointCapture from '@/components/home/PointCapture'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import PostsLiveCard from '@/components/home/PostsLiveCard'
import RelationshipCard from '@/components/home/RelationshipCard'
import PageHelp from '@/components/PageHelp'
import InstallBanner from '@/components/home/InstallBanner'
import AttentionQueue from '@/components/home/AttentionQueue'
import FeedbackResolvedBanner from '@/components/home/FeedbackResolvedBanner'
import { buildAttentionItems } from '@/lib/attentionItems'
import { useChannelHealth } from '@/lib/channelHealth'

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
function HomeSkeleton({ greeting, callFirst, embedded }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading your home…</span>
      {embedded ? (
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your practice</h2>
      ) : (
        <GreetingRibbon greeting={greeting} callFirst={callFirst} />
      )}
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}

// `embedded`: true when rendered as a section inside CombinedHome (an
// owner who is ALSO a clinician — see .claude/decisions.md 2026-07-29
// "combined owner home"). Suppresses the page-level greeting ribbon in
// favor of a section label, since CombinedHome owns the single greeting.
export default function Home({ embedded = false }) {
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

  // Moments IA ⑤ — on-hand inventory summary for the restock nudge inside the
  // interview CTA card. Same cache key /week uses, so this is usually free.
  // Renders ONLY while started && runwayWeeks < 2 (restockNudgeState) — on a
  // healthy workspace this query changes nothing on the page.
  const { data: onHandSummary } = useQuery({
    queryKey: ['moments-summary'],
    queryFn: () => apiFetch('/api/moments/summary'),
    refetchOnWindowFocus: false,
  })
  const restock = restockNudgeState(onHandSummary)

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

  // ── Attention queue ─────────────────────────────────────────────────────────
  // Everything that needs a human, as ITEMS rather than counts. The rules live
  // in @/lib/attentionItems (pure, tested); Home only supplies the data and
  // renders the result.
  //
  // Blog review nudge — clinicians who opted in and have posts awaiting their read.
  //
  // NOT gated on isEditor, for the same reason the answer-review queue below
  // isn't: authorship and role are different things, and an editor who is also
  // a clinician owns blog drafts and must see their own queue. The gate used to
  // be `enabled: !isEditor`, which made this dead for every user at Move Better
  // — `plan: 'internal'` grants ROLE_ADMIN to every org member (useUserRole.js),
  // so isEditor is unconditionally true there and the query never ran. Q is the
  // workspace's most prolific blog author and could not see his own drafts.
  //
  // Dropping the gate does not widen what anyone can see: week-summary's
  // fetchYourReview already filters `staff_id = eq.<the caller's own staff row>`,
  // so authorship was always enforced server-side and the client was simply
  // discarding the result.
  const { data: weekData } = useQuery({
    queryKey: ['week-summary'],
    queryFn: () => apiFetch('/api/content-plan/week-summary'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const yourReview = weekData?.yourReview

  // Answer-review queue — its own fetch (NOT gated on isEditor / week-summary):
  // an editor who is also a clinician owns answers and must see their queue.
  const { data: answerReviewData } = useQuery({
    queryKey: ['answers-review-nudge'],
    queryFn: () => apiFetch('/api/answers'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const yourAnswerReview = answerReviewData?.answers

  // Words approval + practice-memory supersessions — the two clinical
  // checkpoints that had NO aggregate surface anywhere before ProducerHome
  // (2026-07-29 checkpoint audit; see .claude/decisions.md same date). Words
  // approval is the hardest gate in the pipeline: it blocks ALL publishing
  // for a story, and was previously only discoverable by opening the story
  // page directly.
  const { data: myClinicalData } = useQuery({
    queryKey: ['my-clinical-checkpoints'],
    queryFn: () => apiFetch('/api/producer/my-clinical-checkpoints'),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  // The route returns ids + titles now, not bare counts, so each checkpoint can
  // name itself and deep-link.
  const wordsApprovalItems = myClinicalData?.wordsApprovalItems
  const supersessionItems = myClinicalData?.supersessionItems

  // Disconnected channels. Admin-only inside the hook, so a clinician gets an
  // empty list rather than an alarm they can't act on.
  const brokenChannels = useChannelHealth()

  // The whole queue, in one pure call. Failed posts and dead channels are the
  // `blocked` tier — they used to render as separate banners bracketing this
  // strip and were excluded from its count, which is why the headline number
  // was never actually the total.
  //
  // Every `?? []` lives INSIDE the callback on purpose: a `|| []` at the
  // destructuring site mints a fresh array each render, so it can never be a
  // stable dependency and the memo would recompute on every single render.
  const queue = useMemo(
    () => buildAttentionItems({
      stories,
      staff,
      isEditor,
      canReview,
      yourReview: yourReview ?? [],
      yourAnswerReview: yourAnswerReview ?? [],
      wordsApprovals: wordsApprovalItems ?? [],
      supersessions: supersessionItems ?? [],
      brokenChannels,
    }),
    [stories, staff, isEditor, canReview, yourReview, yourAnswerReview, wordsApprovalItems, supersessionItems, brokenChannels]
  )
  const attentionTotal = queue.total

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

  if (isLoading) return <HomeSkeleton greeting={greeting} callFirst={callFirst} embedded={embedded} />

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
      {/* Greeting ribbon — personality + single interview CTA. Suppressed when
          embedded inside CombinedHome, which owns the single page-level
          greeting; a section label stands in its place instead. */}
      {embedded ? (
        <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your practice</h2>
      ) : (
        <GreetingRibbon greeting={greeting} callFirst={callFirst} />
      )}

      {/* Make a point — quick-capture door (Phase 3). Always visible, ahead
          of the hero cascade: a point can strike at any moment, and the box
          is one field, so it never competes for attention the way a hero
          card would. See .claude/make-a-point-spec.md. */}
      <PointCapture />

      {/* Call-first hero — only when it's the winning primary surface (see
          heroState above). Suppressed when onboarding or an in-progress
          interview already owns the "start/continue a call" action, so the
          CTA doesn't appear twice. */}
      {heroState === 'call' && <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} restock={restock} />}

      {/* Attention queue — work before reward: it sits directly under the
          greeting so pending items are seen before the celebratory cards below.
          One card now, not three: the failed-publish and channel-health banners
          used to bracket a count strip and were excluded from its total, so the
          headline number understated the real workload (Q, 2026-08-11). They
          are the `blocked` tier here. Every row deep-links to the item itself. */}
      <AttentionQueue queue={queue} />

      <InstallBanner />

      <FeedbackResolvedBanner />

      {/* F18 — the disclosure beat: what Bernard has quietly noticed about how
          this clinician's interviews have evolved, plus a receipt of what
          shipped for them this week. Sits between the to-do strip and the
          reward card: acknowledgment → receipt → celebration. Self-gated
          (renders nothing with no interview history), so no empty state. */}
      <RelationshipCard />

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
