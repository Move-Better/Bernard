import { Link, Navigate } from 'react-router-dom'
import { CheckCircle, Inbox, Building2, Shield, CalendarDays, Flag } from 'lucide-react'
import { useStories, useCampaigns } from '@/lib/queries'
import { useUserRole } from '@/lib/useUserRole'
import { usePermissionTier } from '@/lib/usePermissionTier'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import StoriesCalendarView from '@/components/stories/StoriesCalendarView'
import StoriesCampaignsView from '@/components/stories/StoriesCampaignsView'
import WeeklyRecapPanel from '@/components/overview/WeeklyRecapPanel'
import { PracticeBrainCard } from '@/components/PracticeBrainReview'
import PageHelp from '@/components/PageHelp'
import PageSkeleton from '@/components/PageSkeleton'

// The clinic-wide, top-down board — separate from Home (which is personal) and
// from Stories/Storyboard (the producer's own work).
// Role-gated to owner / producer / director (admin or publisher).
export default function Overview() {
  useDocumentTitle('Overview')
  const { isEditor, isLoading: roleLoading } = useUserRole()
  const { isProducer, isStaff } = usePermissionTier()

  const { data: stories = [], isLoading } = useStories()
  const { data: campaigns = [] } = useCampaigns()

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

  if (isLoading) return <PageSkeleton variant="dashboard" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-5 w-5 text-primary" aria-hidden="true" />
            Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The whole clinic&rsquo;s content, top-down — every piece, every staff member.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageHelp pageKey="overview" variant="default" />
          <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <Shield className="h-3 w-3" aria-hidden="true" />
            Publisher view
          </span>
        </div>
      </div>

      {/* "What needs me" banner — role-aware, hides when queue is empty */}
      {showPublisherBanner && readyToDistribute.length > 0 && (
        <div className="nx-card-action px-5 py-4 flex items-center gap-3">
          <span className="nx-alert-chip nx-alert-chip-act shrink-0">
            <Inbox className="h-4 w-4" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">
              Your queue: {readyToDistribute.length} post{readyToDistribute.length === 1 ? '' : 's'} ready to publish.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Drafted by AI, media attached — review &amp; schedule each.
            </p>
          </div>
          <Link
            to="/publish"
            className="shrink-0 inline-flex items-center gap-1.5 bg-action text-action-foreground text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Review &amp; publish →
          </Link>
        </div>
      )}
      {showClinicianBanner && (
        <div className="nx-card-action px-5 py-4 flex items-center gap-3">
          <span className="nx-alert-chip nx-alert-chip-act shrink-0">
            <CheckCircle className="h-4 w-4" />
          </span>
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
            className="shrink-0 inline-flex items-center gap-1.5 bg-action text-action-foreground text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Review your drafts →
          </Link>
        </div>
      )}

      {/* Weekly all-staff recap */}
      <PracticeBrainCard />

      <WeeklyRecapPanel stories={stories} />

      {/* Calendar — always visible, no tab needed */}
      <div className="pt-2 border-t">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
          <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
          Calendar
        </h2>
        <StoriesCalendarView stories={stories} isLoading={isLoading} hideRail />
      </div>

      {/* Campaigns — always visible, no tab needed */}
      <div className="pt-2 border-t">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
          <Flag className="h-4 w-4 text-primary" aria-hidden="true" />
          Campaigns
        </h2>
        <StoriesCampaignsView stories={stories} campaigns={campaigns} isLoading={isLoading} />
      </div>
    </div>
  )
}
