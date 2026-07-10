import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { Mic, Target, User, X, ChevronDown, Newspaper, AlertTriangle } from 'lucide-react'
import { useStories, useCampaigns, useStaff, useStaffSummaries, useLocations } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { PLATFORM_META } from '@/lib/contentMeta'
import StoriesCardsView from '@/components/stories/StoriesCardsView'
import CampaignProgressStrip from '@/components/stories/CampaignProgressStrip'
import StoriesAtAGlance from '@/components/stories/StoriesAtAGlance'
import PageHelp from '@/components/PageHelp'
import PageSkeleton from '@/components/PageSkeleton'

const PLATFORMS = Object.keys(PLATFORM_META)

// Quick-filter pills shown above the advanced selects.
// Labels match the canonical pipeline vocabulary used by the Overview kanban
// (contentStatusTokens.js) and Storyboard section headers so one mental model
// spans all three surfaces.
const QUICK_FILTERS = [
  { key: '',            label: 'All' },
  { key: 'needs_words', label: 'Needs words',          stages: ['drafting', 'capture'] },
  { key: 'ready',       label: 'In Review',             stages: ['review'] },
  { key: 'published',   label: 'Published',             stages: ['published'] },
]

// Filter selects keep the native <select> (best mobile UX + free keyboard
// support) but drop the OS dropdown chrome (appearance-none) and draw our own
// chevron. Shape is deliberately rounded-lg (not rounded-full) and lightly
// tinted so it reads as "opens a picker" — distinct from the instant-toggle
// pill row below, which shares the same size/weight but is fully rounded and
// unfilled. Two affordances that behave differently shouldn't look identical.
const SELECT_CLS =
  'appearance-none w-full rounded-lg border border-border bg-muted/40 pl-3 pr-7 py-1.5 text-xs font-medium text-foreground ' +
  'cursor-pointer hover:border-primary/30 hover:bg-muted transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50'

function FilterSelect({ ariaLabel, value, onChange, children }) {
  return (
    <div className="relative shrink-0">
      <select aria-label={ariaLabel} value={value} onChange={onChange} className={SELECT_CLS}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  )
}

/**
 * Stories page — top-level IA surface.
 *
 * Filter controls live in a horizontal chip-row above the grid (no sidebar).
 * The campaign progress strip renders at page level so it's visible in all views.
 */
export default function Stories() {
  useDocumentTitle('Stories')
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useUser()

  const platformFilter = searchParams.get('platform') || ''
  const stageFilter    = searchParams.get('stage')    || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''
  const staffFilter    = searchParams.get('staff')    || ''
  // owner=me restricts the list to the logged-in user's own interviews.
  // The Home page links here via "See all my stories" so clinicians have a
  // dedicated browseable view of their own work as the catalog grows.
  const ownerFilter    = searchParams.get('owner')    || ''
  const mineOnly       = ownerFilter === 'me'
  // 'real' = voice_memo + seminar captures only (Real moments filter)
  const captureFilter  = searchParams.get('capture')  || ''
  const realOnly       = captureFilter === 'real'
  // status=failed — Home's failed-publish banner deep-links here when 2+
  // posts failed, so the user lands on the specific stories that need
  // attention instead of the unfiltered list.
  const statusFilter   = searchParams.get('status')   || ''
  const failedOnly     = statusFilter === 'failed'

  const { data: storiesAll = [], isLoading } = useStories()
  const stories = useMemo(() => {
    let list = mineOnly && user?.id ? storiesAll.filter((s) => s.owner_id === user.id) : storiesAll
    if (realOnly) list = list.filter((s) => s.capture_mode === 'voice_memo' || s.capture_mode === 'seminar')
    if (staffFilter) list = list.filter((s) => s.staff_id === staffFilter)
    return list
  }, [storiesAll, mineOnly, realOnly, staffFilter, user])
  const { data: campaigns = [] } = useCampaigns()
  const { data: staff = [] } = useStaff({ enabled: !!campaignFilter })
  // useStories already populates the staff.card() cache as a side-effect, so
  // this is a zero-network hit used only for the staff filter dropdown.
  const { data: staffAll = [] } = useStaffSummaries()
  const { data: locations = [] } = useLocations()
  const workspace = useWorkspace()
  const awaitingReviewCount = stories.filter((s) => s.story_stage === 'review').length

  const prototypes = getPatientPrototypesUi(workspace).filter((p) => p.id != null)
  const showLocations  = locations.length > 1
  const showArchetypes = prototypes.length > 0

  const activeStaffObj = staffFilter
    ? staffAll.find((s) => s.id === staffFilter) || null
    : null

  const selectableCampaigns = campaigns.filter(
    (c) => c.status === 'active' || c.id === campaignFilter,
  )
  const activeCampaignObj = campaignFilter
    ? campaigns.find((c) => c.id === campaignFilter) || null
    : null

  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  function clearCampaign() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('campaign')
      return next
    }, { replace: true })
  }

  function clearStaff() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('staff')
      return next
    }, { replace: true })
  }

  function clearOwner() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('owner')
      return next
    }, { replace: true })
  }

  function clearStatus() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('status')
      return next
    }, { replace: true })
  }

  function toggleRealOnly() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (realOnly) next.delete('capture')
      else next.set('capture', 'real')
      return next
    }, { replace: true })
  }

  if (isLoading) return <PageSkeleton variant="grid" />

  return (
    <div className="py-6 px-6 flex flex-col gap-4">
      {/* Sticky page chrome — keeps the title and filter chips in view while
          the user scrolls through the cards. -mx-6 px-6 extends the fill to the
          parent main's edges; a solid bg-background prevents scrolled cards from
          ghosting through the bar. */}
      <div className="sticky top-14 md:top-0 z-30 -mx-6 px-6 -mt-6 pt-6 pb-3 bg-background border-b border-border/60 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Newspaper className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
              {failedOnly ? 'Failed posts' : mineOnly ? 'My stories' : 'Stories'}
            </h1>
            {!isLoading && stories.length > 0 ? (
              <span className="text-sm text-muted-foreground truncate">
                {stories.length === 1 ? '1 story' : `${stories.length} stories`}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <PageHelp pageKey="stories" variant="default" />
          </div>
        </div>

        {/* Quick-filter pill row — All / Draft / Ready to Distribute / Published / Mine */}
        <div role="tablist" aria-label="Filter stories" className="flex items-center gap-2 overflow-x-auto flex-nowrap -mx-6 px-6 md:mx-0 md:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK_FILTERS.map((qf) => {
            const isActive = qf.key === ''
              ? !stageFilter && !mineOnly
              : qf.stages
                ? qf.stages.includes(stageFilter)
                : false
            return (
              <button
                key={qf.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  if (qf.key === '') {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev)
                      next.delete('stage')
                      next.delete('owner')
                      return next
                    }, { replace: true })
                  } else if (qf.stages) {
                    setParam('stage', qf.stages[0])
                  }
                }}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40 bg-background'
                }`}
              >
                {qf.label}
                {/* Act-now badge: awaiting-review count rides the In Review pill
                    (amber only while unselected — the "needs you" signal; neutral
                    once the filter is active). Replaces the old standalone header
                    chip that duplicated this same stage=review action. */}
                {qf.key === 'ready' && awaitingReviewCount > 0 ? (
                  <span
                    className={`ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-px text-2xs font-bold ${
                      isActive ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-action/15 text-action'
                    }`}
                  >
                    {awaitingReviewCount}
                  </span>
                ) : null}
              </button>
            )
          })}
          {/* Mine toggle */}
          <button
            type="button"
            role="tab"
            aria-selected={mineOnly}
            onClick={() => mineOnly ? clearOwner() : setParam('owner', 'me')}
            className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              mineOnly
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 bg-card'
            }`}
          >
            Mine
          </button>
        </div>

        {/* Advanced filter bar — horizontal scroll on mobile so chips do not wrap
            into 3+ rows and crowd the sticky header. */}
        <div className="flex items-center gap-2 overflow-x-auto flex-nowrap md:flex-wrap -mx-6 px-6 md:mx-0 md:px-0 pb-1 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Failed-to-publish — active chip only, no selector. Reached via a
            deep link from Home's failed-publish banner (status=failed); there
            is no UI affordance to turn it on manually since it's a triage
            state, not a browsing filter. */}
        {failedOnly ? (
          <button
            type="button"
            onClick={clearStatus}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-destructive bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-semibold hover:bg-destructive/90 transition-colors"
          >
            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
            Failed to publish
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}

        {/* Owner — "Mine only" active chip. No selector form because the only
            two states are "all" and "me"; non-me staff filtering is
            handled by the existing /staff/:id page. */}
        {mineOnly ? (
          <button
            type="button"
            onClick={clearOwner}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <User className="h-3 w-3" aria-hidden="true" />
            Mine only
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}

        {/* Real moments — filters to voice_memo + seminar captures. Follows
            the same model as Campaign/Mine only: a removable chip when active,
            a select when not, so the whole bar shares one interaction model
            (select to choose, chip to clear) instead of mixing a lone toggle
            button with native selects. */}
        {realOnly ? (
          <button
            type="button"
            onClick={toggleRealOnly}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <Mic className="h-3 w-3" aria-hidden="true" />
            Real moments
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : (
          <FilterSelect
            ariaLabel="Filter by real moments"
            value=""
            onChange={(e) => setParam('capture', e.target.value)}
          >
            <option value="">Real moments: All</option>
            <option value="real">Real moments only</option>
          </FilterSelect>
        )}

        {/* Campaign — active chip or selector */}
        {activeCampaignObj ? (
          <button
            type="button"
            onClick={clearCampaign}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-muted text-foreground px-3 py-1.5 text-xs font-semibold hover:bg-muted/70 transition-colors"
          >
            <Target className="h-3 w-3" aria-hidden="true" />
            Campaign: {activeCampaignObj.name}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : selectableCampaigns.length > 0 ? (
          <FilterSelect
            ariaLabel="Filter by campaign"
            value=""
            onChange={(e) => setParam('campaign', e.target.value)}
          >
            <option value="">Campaign: All</option>
            {selectableCampaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </FilterSelect>
        ) : null}

        {/* Staff / author — active chip or selector */}
        {activeStaffObj ? (
          <button
            type="button"
            onClick={clearStaff}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-foreground/15 bg-muted text-foreground px-3 py-1.5 text-xs font-semibold hover:bg-muted/70 transition-colors"
          >
            <User className="h-3 w-3" aria-hidden="true" />
            {activeStaffObj.name}
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : staffAll.length > 1 ? (
          <FilterSelect
            ariaLabel="Filter by author"
            value=""
            onChange={(e) => setParam('staff', e.target.value)}
          >
            <option value="">Author: All</option>
            {staffAll.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </FilterSelect>
        ) : null}

        {/* Platform */}
        <FilterSelect
          ariaLabel="Filter by platform"
          value={platformFilter}
          onChange={(e) => setParam('platform', e.target.value)}
        >
          <option value="">Platform: All</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_META[p].label}</option>
          ))}
        </FilterSelect>

        {/* Location — only when workspace has multiple */}
        {showLocations ? (
          <FilterSelect
            ariaLabel="Filter by location"
            value={locationFilter}
            onChange={(e) => setParam('location', e.target.value)}
          >
            <option value="">Location: All</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.label || loc.city}</option>
            ))}
          </FilterSelect>
        ) : null}

        {/* Patient type — only when workspace has defined prototypes */}
        {showArchetypes ? (
          <FilterSelect
            ariaLabel="Filter by patient type"
            value={searchParams.get('archetype') || ''}
            onChange={(e) => setParam('archetype', e.target.value)}
          >
            <option value="">Patient type: All</option>
            {prototypes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji ? `${p.emoji} ${p.label}` : p.label}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        </div>
      </div>

      {/* Campaign progress strip — shown whenever a campaign filter is
          active. Lives below the sticky chrome so it scrolls with content. */}
      {activeCampaignObj ? (
        <CampaignProgressStrip campaign={activeCampaignObj} staff={staff} />
      ) : null}

      {/* Cards only. The Pipeline / Calendar / Themes lenses moved to the
          clinic-wide Overview board (Phase 5 of the pipeline UX redesign); the
          producer's Stories list stays a clean place to do the words. */}
      <StoriesCardsView stories={stories} isLoading={isLoading} />

      {/* At-a-glance KPI footer — derived from the same `stories` data the
          views above are rendering, so no extra fetch. Auto-hides when the
          workspace has no stories yet. */}
      {!isLoading ? <StoriesAtAGlance stories={stories} /> : null}
    </div>
  )
}
