import { Link, useSearchParams, Navigate } from 'react-router-dom'
import { CheckCircle, Inbox, LayoutGrid, Shield } from 'lucide-react'
import { useStories } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { usePermissionTier } from '@/lib/usePermissionTier'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import StoriesPipelineView from '@/components/stories/StoriesPipelineView'
import StoriesCardsView from '@/components/stories/StoriesCardsView'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesCampaignsView from '@/components/stories/StoriesCampaignsView'
import WeeklyRecapPanel from '@/components/overview/WeeklyRecapPanel'
import PageHelp from '@/components/PageHelp'

// The clinic-wide, top-down board — separate from Home (which is personal) and
// from Stories/Storyboard (the producer's own work). Three lenses on the same
// content: Pipeline (by stage), Calendar (by ship date), Themes (by topic +
// gaps). These moved OFF the producer's Stories list, where they didn't belong.
//
// Role-gated to owner / producer / director (admin or publisher). An individual
// clinician just uses Home + their work and never sees this surface.
const LENSES = [
  ['pipeline', 'Pipeline'],
  ['cards', 'Cards'],
  ['calendar', 'Calendar'],
  ['campaigns', 'Campaigns'],
]

export default function Overview() {
  useDocumentTitle('Overview')
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const { isProducer, isStaff } = usePermissionTier()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = searchParams.get('view') || 'pipeline'

  const { data: stories = [], isLoading } = useStories()

  // Role gate — individual clinicians don't get the clinic-wide board. Wait for
  // the role to resolve before deciding so we don't bounce an editor mid-load.
  if (!roleLoading && !isEditor) return <Navigate to="/" replace />

  // "What needs me" banner — derived from stories data.
  // readyToDistribute: stories that have at least 1 approved piece (ready to ship).
  // blogsToApprove: stories in the 'review' stage (at least one piece in_review).
  const readyToDistribute = stories.filter((s) => (s.pieces_by_status?.approved ?? 0) > 0)
  const blogsToApprove = stories.filter((s) => s.story_stage === 'review')

  // Publisher inbox banner — shown to producers (or any editor when queue is non-empty).
  const showPublisherBanner = isProducer || (isEditor && readyToDistribute.length > 0)
  // Clinician approval banner — shown to staff members when blogs need their sign-off.
  const showClinicianBanner = !showPublisherBanner && isStaff && blogsToApprove.length > 0

  const setView = (v) =>
    setSearchParams(
      (prev) => {
        prev.set('view', v)
        return prev
      },
      { replace: true },
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <LayoutGrid className="h-5 w-5 text-primary" aria-hidden="true" />
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The whole clinic&rsquo;s content, top-down — every piece, every staff member.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="overview" variant="default" />
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Publisher view
          </span>
        </div>
      </div>

      {/* "What needs me" banner — role-aware, hides when queue is empty */}
      {showPublisherBanner && readyToDistribute.length > 0 && (
        <div className="rounded-2xl border border-action/30 bg-gradient-to-b from-white to-[#fffbf2] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(217,119,6,0.22)] px-5 py-4 flex items-center gap-3">
          <span className="inline-block w-1 h-6 rounded-full shrink-0 bg-action" aria-hidden="true" />
          <Inbox className="h-4 w-4 text-action shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              Your queue: {readyToDistribute.length} post{readyToDistribute.length === 1 ? '' : 's'} ready to go out the door.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aimed by AI, media attached — review &amp; schedule each.
            </p>
          </div>
          <Link
            to="/publish"
            className="shrink-0 inline-flex items-center gap-1.5 bg-action text-white text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Work the inbox →
          </Link>
        </div>
      )}
      {showClinicianBanner && (
        <div className="rounded-2xl border border-border bg-card px-5 py-4 flex items-center gap-3 shadow-sm">
          <CheckCircle className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              {blogsToApprove.length} blog{blogsToApprove.length === 1 ? '' : 's'} waiting on your approval.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Read it, make sure it sounds like you, approve.
            </p>
          </div>
          <Link
            to="/stories?stage=review"
            className="shrink-0 inline-flex items-center gap-1.5 border border-border bg-muted text-foreground text-xs font-semibold px-3 py-2 rounded-lg hover:bg-accent transition-colors"
          >
            Validate your words →
          </Link>
        </div>
      )}

      {/* Weekly all-staff recap — workspace-wide "this week" snapshot, team
          cadence, and estimated run-cost. Pinned above the lenses so it's the
          first thing on screen when the board is shared in the staff meeting. */}
      <WeeklyRecapPanel stories={stories} />

      {/* Lens toggle — Pipeline / Calendar / Themes, persisted in ?view= */}
      <div className="inline-flex rounded-md border p-0.5 text-xs font-medium">
        {LENSES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`rounded px-3 py-1 transition-colors ${
              view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Lens dispatch — same data + the same view components Stories used to
          host, so the board stays consistent with the producer's surfaces. */}
      {view === 'cards' ? (
        <StoriesCardsView stories={stories} isLoading={isLoading} />
      ) : view === 'calendar' ? (
        <StoriesCalendarView stories={stories} isLoading={isLoading} />
      ) : view === 'campaigns' ? (
        <StoriesCampaignsView stories={stories} isLoading={isLoading} />
      ) : (
        <StoriesPipelineView stories={stories} isLoading={isLoading} />
      )}
    </div>
  )
}
