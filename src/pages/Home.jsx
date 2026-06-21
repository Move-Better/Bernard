import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Clock, Loader2, RefreshCw, ChevronRight, Send, Mic2, BookOpen } from 'lucide-react'
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
import DraftsReadyRow from '@/components/home/DraftsReadyRow'
import GettingStarted from '@/components/home/GettingStarted'
import WeeklyCallHero from '@/components/home/WeeklyCallHero'
import OnboardingCard from '@/components/home/OnboardingCard'
import HomeStats from '@/components/home/HomeStats'
import ResumeStrip from '@/components/home/ResumeStrip'
import PlanNextInterview from '@/components/home/PlanNextInterview'
import TaskBucketCard from '@/components/home/TaskBucketCard'
import PostsLiveCard from '@/components/home/PostsLiveCard'
import MyWorkCard from '@/components/home/MyWorkCard'
import HomeRightRail from '@/components/home/HomeRightRail'
import PageHelp from '@/components/PageHelp'
import InstallBanner from '@/components/home/InstallBanner'

const RESUME_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export default function Home() {
  useDocumentTitle('Home')
  const { user } = useUser()
  const { canReview, isEditor } = useUserRole()
  const runtimeWorkspace = useWorkspace()
  const [searchParams] = useSearchParams()

  // Stories (interviews + content pieces merged)
  const { data: stories = [], isLoading: storiesLoading, error: storiesError, refetch: refetchStories, isFetching: isRefetchingStories } = useStories()

  // Slim clinician summaries — free cache hit when Stories has loaded first
  // (useStories populates the card cache as a side-effect). Includes
  // session_state so we can identify in-progress interviews for the resume strip.
  const { data: staff = [], isLoading: staffLoading } = useStaffSummaries()

  // ?bucket= deep-link scroll
  useEffect(() => {
    const bucket = searchParams.get('bucket')
    if (!bucket) return
    // Small defer so the DOM has rendered the buckets before scrolling
    const timer = setTimeout(() => {
      document.getElementById(bucket)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
    return () => clearTimeout(timer)
  }, [searchParams])

  // Derived data from stories
  const allInterviews = useMemo(
    () =>
      staff.flatMap((c) =>
        (c.interviews || []).map((i) => ({ ...i, staffName: c.name, staffId: c.id }))
      ),
    [staff]
  )

  // F1 Phase A — the current user's most recent completed interview, for the
  // "N days since your last call" nudge in the call-first hero. Practice-wide
  // interviews are owner-tagged; filter to this user's own so the nudge is
  // personal, not the whole team's last call.
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
          // "pick up where YOU left off" — only show the current user's own
          // in-progress interviews, not every clinician's open sessions.
          i.owner_id === user?.id
      )
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
  }, [allInterviews, user])

  // Derive from stories (already loaded) — each story maps 1:1 to an interview
  const existingTopics = useMemo(
    () => stories.map((s) => s.topic),
    [stories]
  )

  // Archetype filter for PlanNextInterview. null = no filter. Workspaces
  // with no patient_context.prototypes don't render the chip strip, so
  // this stays null and the gap list behaves exactly as before.
  const [topicFilterPrototype, setTopicFilterPrototype] = useState(null)
  const prototypesUi = useMemo(
    () => getPatientPrototypesUi(runtimeWorkspace),
    [runtimeWorkspace]
  )
  // The unfiltered gap baseline drives whether to render PlanNextInterview
  // at all. If the workspace has gaps overall but an archetype filter zeros
  // them out, we still render the card (with empty-state copy + chips) so
  // the user can clear the filter — otherwise it disappears and the filter
  // becomes unreachable.
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

  // ── Task bucket 1: Ready for content ───────────────────────────────────────
  // Stories in 'drafting' stage with no content pieces yet
  const readyForContent = useMemo(
    () => stories.filter((s) => s.story_stage === 'drafting' && (s.pieces_count || 0) === 0),
    [stories]
  )

  // ── Awaiting review ─────────────────────────────────────────────────────
  // Bucket 2 used to be a story-level TaskBucketCard. As of the mockup
  // parity pass the surface is now piece-level (DraftsReadyRow), which
  // re-derives pending pieces from `stories` directly — no separate
  // useMemo needed here. `canReview` still gates rendering at the JSX
  // site below.

  // ── Task bucket 3: Ready to distribute ─────────────────────────────────────
  // Stories with at least one approved piece — publisher's inbox. Only shown
  // to staff since staff don't distribute; an empty list hides the card.
  const readyToDistribute = useMemo(
    () =>
      isEditor
        ? stories.filter((s) => (s.pieces_by_status?.approved ?? 0) > 0)
        : [],
    [stories, isEditor]
  )

  // ── Task bucket 4: Due for an interview ─────────────────────────────────────
  // Clinicians with 0 interviews OR most recent interview > 30 days ago
  const overdueStaffItems = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
    return staff.filter((c) => {
      const interviews = c.interviews || []
      if (interviews.length === 0) return true
      const mostRecent = interviews.reduce((latest, i) => {
        const t = new Date(i.updated_at || i.created_at || 0).getTime()
        return t > latest ? t : latest
      }, 0)
      return mostRecent < thirtyDaysAgo
    })
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

  // F1 Phase A — when the workspace has realtime voice enabled, the call is the
  // default front door: render the WeeklyCallHero and drop the ribbon's
  // "Start an interview" CTA (the hero owns the primary action). Non-enabled
  // workspaces keep today's ribbon CTA exactly, so there's no broken link.
  const callFirst = runtimeWorkspace?.realtime_voice_enabled === true

  // Lane accent colors for the bucket rails. The "your turn / do this now"
  // surfaces all share the amber --action token (NOT emerald — emerald reads
  // as "done"); overdue is neutral slate, informational rather than urgent.
  const ACCENT = {
    ready:        'hsl(var(--action))', // act-now — drafting needed (your turn)
    review:       'hsl(var(--action))', // act-now — your review queue
    distribute:   'hsl(var(--action))', // act-now — publisher surface
    overdue:      'hsl(var(--muted-foreground))', // informational, not an urgent action
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting — slim gradient ribbon. The page's single "moment" of
          the brand gradient; keep it short so body content stays above
          the fold. */}
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
              Start an interview
            </Link>
          )}
        </div>
      </div>

      {/* F1 Phase A — call-first hero. Only for realtime-enabled workspaces;
          others fall through to the ribbon CTA above. */}
      {callFirst && <WeeklyCallHero lastOwnCallAt={lastOwnCallAt} />}

      <InstallBanner />

      {/* "Close the loop" reward — the clinician's own pieces that went live
          this week. Sits high so the payoff lands before the to-do surfaces.
          Self-hides when the user has nothing live this week. */}
      <PostsLiveCard stories={stories} userId={user?.id} />

      {/* "Finish onboarding" card. Self-gated (admin + workspace not yet
          onboarded + not snoozed) — renders nothing for the 99% case. Sits
          above HomeStats so the founder's first task lands above the fold. */}
      <OnboardingCard />

      {/* Pre-roll: one section at a time. Priority: resume in-progress >
          coverage gaps (active workspace) > getting started (new workspace). */}
      {resumeInterviews.length > 0 ? (
        <ResumeStrip interviews={resumeInterviews} currentUserId={user?.id} staff={staff} />
      ) : unfilteredGaps.length > 0 && stories.length > 0 ? (
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

      {/* Main content: task buckets left, right rail right. Stacks to a single
          column below lg (rail drops under the buckets with a separator);
          becomes a two-column row at lg+ where the rail is a fixed sidebar. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          {/* "My work & where it stands" — the clinician's own pieces with
              their pipeline stage + next action. Replaces the old thin
              "My recent stories" list so a busy clinician sees status, not
              just topics. Self-hides for accounts with no owned stories. */}
          <MyWorkCard stories={stories} userId={user?.id} />

          {/* Blog review nudge — for clinicians with blog_review_enabled who
              have posts waiting for their read/approval on /week. */}
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

          {/* Drafts ready for review — others' work needing your action.
              Sits above "Ready for content" so the most-urgent action
              queue (someone waiting on review) lands before editorial
              drafting work. Piece-level (not story-level) so the user can
              see "this blog · this email · this social" at a glance. */}
          {canReview ? <DraftsReadyRow stories={stories} /> : null}

          <TaskBucketCard
            id="ready"
            title="Ready for content"
            icon={<FileText className="h-4 w-4" />}
            accent={ACCENT.ready}
            items={readyForContent}
            emptyMessage="No stories waiting for content — great work."
            renderItem={(s) => (
              <Link
                key={s.id}
                to={`/stories/${s.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.staffName}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.topic}</p>
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                  Start drafting <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            )}
          />

          {readyToDistribute.length > 0 && (
            <TaskBucketCard
              id="distribute"
              title="Ready to distribute"
              icon={<Send className="h-4 w-4" />}
              accent={ACCENT.distribute}
              items={readyToDistribute}
              emptyMessage="Nothing approved yet — check back after review."
              renderItem={(s) => {
                const approvedCount = s.pieces_by_status?.approved ?? 0
                return (
                  <Link
                    key={s.id}
                    to={`/stories/${s.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.staffName}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {s.topic}
                        {approvedCount > 1 ? ` · ${approvedCount} pieces` : ''}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                      Distribute <ChevronRight className="h-3 w-3" />
                    </span>
                  </Link>
                )
              }}
            />
          )}

          <TaskBucketCard
            id="overdue"
            title="Due for an interview"
            icon={<Clock className="h-4 w-4" />}
            accent={ACCENT.overdue}
            items={overdueStaffItems}
            emptyMessage="Everyone has been interviewed recently — great cadence."
            renderItem={(c) => (
              <Link
                key={c.id}
                to="/new"
                className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(c.interviews || []).length === 0
                      ? 'No interviews yet'
                      : 'Last interview over 30 days ago'}
                  </p>
                </div>
                <span className="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors flex items-center gap-0.5">
                  Schedule <ChevronRight className="h-3 w-3" />
                </span>
              </Link>
            )}
          />
        </div>

        {/* Right rail — fixed sidebar at lg+. On mobile, CSS order-first moves
            this above the task buckets so the Voice Match KPI is reachable
            without scrolling past the whole queue. Desktop layout is unaffected
            (lg:order-none resets, DOM order keeps tasks on left / stats on right). */}
        <div className="w-full lg:w-72 lg:flex-shrink-0 order-first lg:order-none">
          <div className="lg:hidden mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              Your week at a glance
            </h2>
          </div>
          {stories.length > 0 ? <HomeStats stories={stories} /> : null}
          <HomeRightRail stories={stories} />
        </div>
      </div>

    </div>
  )
}
