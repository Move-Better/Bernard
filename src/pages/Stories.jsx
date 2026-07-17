import { useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { Mic, Target, User, X, ChevronDown, Newspaper, AlertTriangle, SlidersHorizontal, Search, ArrowDownUp, Plus } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useStories, useCampaigns, useStaff, useStaffSummaries, useLocations } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { getPatientPrototypesUi } from '@/lib/prompts'
import { PLATFORM_META } from '@/lib/contentMeta'
import StoriesTableView from '@/components/stories/StoriesTableView'
import PostsTableView from '@/components/stories/PostsTableView'
import { Button } from '@/components/ui/button'
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

// A labelled full-width select — the form the advanced filters take inside the
// Filters popover.
function FilterField({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold text-muted-foreground">{label}</span>
      <div className="relative">
        <select value={value} onChange={onChange} className={SELECT_CLS}>
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    </label>
  )
}

// Removable pill for an applied advanced filter — shown beside the Filters
// button so what's active stays visible without opening the popover.
function ActiveFilterChip({ icon: Icon, label, onClear, tone = 'muted' }) {
  const tones = {
    muted: 'border-foreground/15 bg-muted text-foreground hover:bg-muted/70',
    primary: 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
    destructive: 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90',
  }
  return (
    <button
      type="button"
      onClick={onClear}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${tones[tone]}`}
    >
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {label}
      <X className="h-3 w-3" aria-hidden="true" />
    </button>
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
  const archetypeFilter = searchParams.get('archetype') || ''
  // status=failed — Home's failed-publish banner deep-links here when 2+
  // posts failed, so the user lands on the specific stories that need
  // attention instead of the unfiltered list.
  const statusFilter   = searchParams.get('status')   || ''
  const failedOnly     = statusFilter === 'failed'
  // Free-text search over the story subject/topic, and chronological sort —
  // the two primitives that make the list usable once it grows past a screenful.
  const searchQuery    = searchParams.get('q')    || ''
  const sortAsc        = searchParams.get('sort') === 'oldest'
  // Stories | Posts top-level tab. Posts is the home for one-off Post content
  // (no interview) that the story views structurally can't render.
  const tab            = searchParams.get('tab') || 'stories'

  // How many of the six advanced (popover) filters are applied — drives the
  // count badge on the Filters button. (Status tabs, Mine, and the failed-triage
  // deep link are separate surfaces, not counted here.)
  const advancedCount = [realOnly, campaignFilter, staffFilter, platformFilter, locationFilter, archetypeFilter]
    .filter(Boolean).length

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

  function toggleSort() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (sortAsc) next.delete('sort')          // back to default (newest first)
      else next.set('sort', 'oldest')
      return next
    }, { replace: true })
  }

  function clearAllAdvanced() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const k of ['capture', 'campaign', 'staff', 'platform', 'location', 'archetype']) next.delete(k)
      return next
    }, { replace: true })
  }

  // Posts tab — a self-contained surface (its own header + list). Rendered
  // before the stories loading gate so it isn't blocked by the stories fetch.
  if (tab === 'posts') {
    return (
      <div className="py-6 px-6 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            Stories
          </h1>
          <Button asChild size="sm">
            <Link to="/new/brief"><Plus className="h-4 w-4 mr-1" aria-hidden="true" />New post</Link>
          </Button>
        </div>
        <PageTabs tab="posts" onSelect={(t) => setParam('tab', t === 'stories' ? '' : t)} />
        <PostsTableView />
      </div>
    )
  }

  if (isLoading) return <PageSkeleton variant="list" />

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

        <PageTabs tab="stories" onSelect={(t) => setParam('tab', t === 'stories' ? '' : t)} />

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

        {/* Search + sort — the two primitives that keep the list scannable as it
            grows. Search filters by subject; sort flips chronological order
            (titles are date-first, so newest→oldest reads naturally). */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0 max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder="Search stories by subject…"
              aria-label="Search stories by subject"
              className="w-full rounded-lg border border-border bg-muted/40 pl-8 pr-8 py-1.5 text-xs font-medium text-foreground placeholder:text-muted-foreground/70 hover:border-primary/30 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setParam('q', '')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={toggleSort}
            title={sortAsc ? 'Oldest first' : 'Newest first'}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/30 hover:bg-muted transition-colors"
          >
            <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="hidden sm:inline">{sortAsc ? 'Oldest first' : 'Newest first'}</span>
          </button>
          {/* Advanced filters — compact trigger on the search row (icon-only on
              mobile) so it isn't a fourth pinned row. Radix portals the panel, so
              the trigger's DOM position here is all that matters; applied chips
              render below the sticky header, scrolling with content. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Filters"
                aria-label="Filters"
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition-colors ${
                  advancedCount > 0
                    ? 'border-primary/40 bg-primary/5 text-foreground hover:bg-primary/10'
                    : 'border-border bg-muted/40 text-foreground hover:border-primary/30 hover:bg-muted'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Filters</span>
                {advancedCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-primary text-primary-foreground text-2xs font-bold">
                    {advancedCount}
                  </span>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground hidden sm:inline" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 space-y-3 p-3">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Filters</span>
                {advancedCount > 0 && (
                  <button type="button" onClick={clearAllAdvanced} className="text-2xs font-semibold text-primary hover:underline">
                    Clear all
                  </button>
                )}
              </div>

              <FilterField label="Real moments" value={captureFilter} onChange={(e) => setParam('capture', e.target.value)}>
                <option value="">All stories</option>
                <option value="real">Real moments only</option>
              </FilterField>

              {selectableCampaigns.length > 0 && (
                <FilterField label="Campaign" value={campaignFilter} onChange={(e) => setParam('campaign', e.target.value)}>
                  <option value="">All campaigns</option>
                  {selectableCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </FilterField>
              )}

              {staffAll.length > 1 && (
                <FilterField label="Author" value={staffFilter} onChange={(e) => setParam('staff', e.target.value)}>
                  <option value="">All authors</option>
                  {staffAll.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </FilterField>
              )}

              <FilterField label="Platform" value={platformFilter} onChange={(e) => setParam('platform', e.target.value)}>
                <option value="">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                ))}
              </FilterField>

              {showLocations && (
                <FilterField label="Location" value={locationFilter} onChange={(e) => setParam('location', e.target.value)}>
                  <option value="">All locations</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.label || loc.city}</option>
                  ))}
                </FilterField>
              )}

              {showArchetypes && (
                <FilterField label="Patient type" value={archetypeFilter} onChange={(e) => setParam('archetype', e.target.value)}>
                  <option value="">All patient types</option>
                  {prototypes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji ? `${p.emoji} ${p.label}` : p.label}
                    </option>
                  ))}
                </FilterField>
              )}
            </PopoverContent>
          </Popover>
        </div>

      </div>

      {/* Applied-filter chips (removable) — click to clear. Live BELOW the sticky
          header so they scroll with content instead of pinning a fourth row;
          rendered only when a filter is active. */}
      {(failedOnly || realOnly || activeCampaignObj || activeStaffObj || platformFilter || locationFilter || archetypeFilter) && (
        <div className="flex flex-wrap items-center gap-2">
          {failedOnly && (
            <ActiveFilterChip icon={AlertTriangle} label="Failed to publish" tone="destructive" onClear={clearStatus} />
          )}
          {realOnly && (
            <ActiveFilterChip icon={Mic} label="Real moments" tone="primary" onClear={toggleRealOnly} />
          )}
          {activeCampaignObj && (
            <ActiveFilterChip icon={Target} label={`Campaign: ${activeCampaignObj.name}`} onClear={clearCampaign} />
          )}
          {activeStaffObj && (
            <ActiveFilterChip icon={User} label={activeStaffObj.name} onClear={clearStaff} />
          )}
          {platformFilter && (
            <ActiveFilterChip label={`Platform: ${PLATFORM_META[platformFilter]?.label || platformFilter}`} onClear={() => setParam('platform', '')} />
          )}
          {locationFilter && (
            <ActiveFilterChip
              label={`Location: ${locations.find((l) => l.id === locationFilter)?.label || locations.find((l) => l.id === locationFilter)?.city || locationFilter}`}
              onClear={() => setParam('location', '')}
            />
          )}
          {archetypeFilter && (
            <ActiveFilterChip
              label={`Patient type: ${prototypes.find((p) => p.id === archetypeFilter)?.label || archetypeFilter}`}
              onClear={() => setParam('archetype', '')}
            />
          )}
        </div>
      )}

      {/* Campaign progress strip — shown whenever a campaign filter is
          active. Lives below the sticky chrome so it scrolls with content. */}
      {activeCampaignObj ? (
        <CampaignProgressStrip campaign={activeCampaignObj} staff={staff} />
      ) : null}

      {/* Dense table — replaces the card grid so the catalog stays fast to
          scan/search/filter as it grows to thousands of stories across
          clinicians. Pipeline / Calendar / Themes lenses live on the
          clinic-wide Overview board. */}
      <StoriesTableView stories={stories} isLoading={isLoading} />

      {/* At-a-glance KPI footer — derived from the same `stories` data the
          views above are rendering, so no extra fetch. Auto-hides when the
          workspace has no stories yet. */}
      {!isLoading ? <StoriesAtAGlance stories={stories} /> : null}
    </div>
  )
}

// Top-level Stories | Posts switch. Posts is the home for one-off Post content
// (no interview), which the interview-grouped story views structurally can't
// show. Module scope (react-hooks/static-components).
function PageTabs({ tab, onSelect }) {
  return (
    <div className="flex items-center border-b border-border" role="tablist" aria-label="Stories or Posts">
      {[['stories', 'Stories'], ['posts', 'Posts']].map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => onSelect(key)}
          className={`text-sm font-semibold px-1 pb-2 mr-6 -mb-px border-b-2 transition-colors ${
            tab === key
              ? 'text-foreground border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
