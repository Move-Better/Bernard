import { useMemo, useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Mic, SearchX, AlertTriangle, Target, ChevronLeft, ChevronRight, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StaffChip } from '@/components/StaffChip'
import EmptyState from '@/components/EmptyState'
import { getStageToken } from '@/lib/stageTokens'
import { queryKeys, fetchStory, useStory } from '@/lib/queries'
import { formatStoryDate, stripStoryDatePrefix } from '@/lib/storyTitle'
import { PLATFORM_META } from '@/lib/contentMeta'

// Rows per page — bounds the rendered DOM so the list scales to thousands of
// stories without ever mounting thousands of rows (Q: "won't scale").
const PAGE_SIZE = 50

// Short platform labels for the compact platform column.
const PLATFORM_SHORT = {
  blog: 'Blog', instagram: 'IG', instagram_story: 'Story', facebook: 'FB',
  linkedin: 'LI', gbp: 'GBP', google_ads: 'G Ads', instagram_ads: 'IG Ads',
  landing_page: 'LP', youtube: 'YT', tiktok: 'TT', email: 'Email',
}

// Per-channel lifecycle state for an expanded sub-row, derived from the piece's
// own fields. Same lineage as PostsTableView.pieceState so the two surfaces
// bucket channels identically.
function channelState(p) {
  if (p.status === 'failed') return 'failed'
  if (p.status === 'published' || p.published_at) return 'published'
  if (p.status === 'scheduled' || p.scheduled_at) return 'scheduled'
  return 'draft'
}

// Sub-row status token: rail color + pill. Draft rides the amber act-now token
// (needs you), scheduled = info, published = success, failed = destructive.
const CH_STATE = {
  draft:     { label: 'Draft',     pill: 'bg-action/15 text-action',           rail: 'border-action' },
  scheduled: { label: 'Scheduled', pill: 'bg-info/15 text-info',               rail: 'border-info' },
  published: { label: 'Published', pill: 'bg-success/15 text-success',          rail: 'border-success' },
  failed:    { label: 'Failed',    pill: 'bg-destructive/15 text-destructive', rail: 'border-destructive' },
}

// When-label for a channel: scheduled shows its slot, published shows when it
// went out; drafts have no time.
function channelWhen(state, p) {
  const iso = state === 'scheduled'
    ? p.scheduled_at
    : state === 'published'
      ? (p.published_at || p.updated_at)
      : null
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// First non-empty line of the caption, minus a leading markdown heading marker —
// the scannable per-channel preview. Only string content has a preview; carousel
// slide JSON / missing content degrade to no preview (opportunistic, from the
// full-piece detail cache the row already hover-prefetches).
function captionPreview(content) {
  if (typeof content !== 'string') return ''
  const line = content.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return line.replace(/^#{1,6}\s+/, '')
}

// The story date the list sorts + groups by. created_at is the interview date
// (also the source of the date-first display title); fall back to last activity.
function storyDateMs(s) {
  const iso = s.created_at || s.last_activity_at || s.updated_at
  return iso ? new Date(iso).getTime() : 0
}

// Date column — uses the SAME shared UTC formatter as the date-first display
// title (src/lib/storyTitle.js) so the list's date and StoryDetail's title
// never disagree by a timezone day.
function fmtShortDate(ms) {
  return ms ? formatStoryDate(ms) || '—' : '—'
}

function monthLabel(ms) {
  if (!ms) return 'Undated'
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Titles are date-first; the table has its own Date column, so strip a leading
// date prefix from the topic to keep the Subject column clean and non-redundant.
// Uses the shared helper (single source of truth for the title format) — which
// covers both the canonical numeric form ("MM/DD/YY — subject") and the
// long-form month-name form ("July 10, 2026 — subject") legacy auto-titles use —
// rather than a local copy of the regex.
function storySubject(s) {
  const t = (s.topic || '').trim()
  if (!t) return ''
  return stripStoryDatePrefix(t) || t
}

/**
 * StoriesTableView — dense, scannable, paginated list of stories.
 *
 * Replaces the card grid so the catalog stays fast to scan/filter/search as it
 * grows to thousands of stories across clinicians. Search + sort come from URL
 * params (owned by the parent toolbar); platform/stage/location/campaign/
 * archetype/failed filters are applied here (parity with the old cards view).
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesTableView({ stories = [], isLoading = false }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const containerRef = useRef(null)
  const [page, setPage] = useState(0)
  // Expanded story ids — a Set keyed by story.id (NOT row index) so re-sorts,
  // filter changes, and pagination keep the right rows open and never jump.
  const [expanded, setExpanded] = useState(() => new Set())
  function toggleExpand(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const query          = (searchParams.get('q') || '').trim().toLowerCase()
  const sortAsc        = searchParams.get('sort') === 'oldest'
  const platformFilter = searchParams.get('platform') || ''
  const stageFilter    = searchParams.get('stage')    || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''
  const archetypeFilter = searchParams.get('archetype') || ''
  const failedOnly     = searchParams.get('status') === 'failed'

  const filtered = useMemo(() => {
    const list = stories.filter((s) => {
      if (platformFilter && !s.pieces?.some((p) => p.platform === platformFilter)) return false
      if (stageFilter    && s.story_stage !== stageFilter)                          return false
      if (locationFilter && s.location_id !== locationFilter)                       return false
      if (campaignFilter && s.campaign_id !== campaignFilter)                       return false
      if (archetypeFilter && s.prototype_id !== archetypeFilter)                    return false
      if (failedOnly && !s.pieces?.some((p) => p.status === 'failed'))              return false
      if (query && !(s.topic || '').toLowerCase().includes(query))                  return false
      return true
    })
    list.sort((a, b) => (sortAsc ? storyDateMs(a) - storyDateMs(b) : storyDateMs(b) - storyDateMs(a)))
    return list
  }, [stories, platformFilter, stageFilter, locationFilter, campaignFilter, archetypeFilter, failedOnly, query, sortAsc])

  const filtersActive = !!(platformFilter || stageFilter || campaignFilter || locationFilter || archetypeFilter || failedOnly || query)

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // Reset to the first page whenever the result set changes (filter/search/sort).
  const resetKey = `${filtered.length}|${query}|${sortAsc}|${platformFilter}|${stageFilter}|${locationFilter}|${campaignFilter}|${archetypeFilter}|${failedOnly}`
  useEffect(() => { setPage(0) }, [resetKey])

  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * PAGE_SIZE
  const pageItems = filtered.slice(start, start + PAGE_SIZE)

  function goToPage(p) {
    setPage(p)
    // Bring the table top back into view so a new page isn't loaded under the
    // old scroll position (same "scroll to top on advance" contract as review
    // queues — see CLAUDE.md).
    containerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-11 border-b border-border/60 bg-card animate-pulse last:border-b-0" />
        ))}
      </div>
    )
  }

  if (filtered.length === 0) {
    if (filtersActive) {
      const clearFilters = () => setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['platform', 'stage', 'campaign', 'archetype', 'location', 'status', 'q']) next.delete(k)
        return next
      }, { replace: true })
      return (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center">
          <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center mb-3">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">No stories match your search or filters</p>
          <p className="text-xs mt-1 mb-3">Try widening or clearing them to see more.</p>
          <Button size="sm" variant="outline" onClick={clearFilters}>Clear all</Button>
        </div>
      )
    }
    return (
      <EmptyState
        icon={<Mic className="h-5 w-5" />}
        title="Your stories start with a conversation"
        description="Talk for a few minutes about your practice and Bernard turns it into a story — a cluster of publish-ready drafts your team can review and send out."
        action={<Button asChild size="sm"><Link to="/new/live-interview">Start a conversation</Link></Button>}
        secondaryAction={<Button asChild size="sm" variant="outline"><Link to="/new/import">Import existing content</Link></Button>}
      />
    )
  }

  // Precompute each visible row with its month + whether it opens a new month
  // group — done here (not mutated during render) so a group header can be
  // injected before the first row of each month.
  const rows = pageItems.map((s, i) => {
    const ms = storyDateMs(s)
    const ml = monthLabel(ms)
    const showMonth = i === 0 || ml !== monthLabel(storyDateMs(pageItems[i - 1]))
    return { s, ms, ml, showMonth }
  })

  return (
    <div className="flex flex-col gap-3" ref={containerRef}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-muted-foreground">
              <th className="w-9 px-1" aria-hidden="true"></th>
              <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-24">Date</th>
              <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2">Subject</th>
              <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-40">Author</th>
              <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-28">Stage</th>
              <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-44">Platforms</th>
              <th className="text-right font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-20">Pieces</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, ms, ml, showMonth }) => {
              const { badge, label, rail } = getStageToken(s.story_stage || '')
              const pieces = s.pieces || []
              const platforms = [...new Set(pieces.map((p) => p.platform).filter(Boolean))]
              // Per-platform state so the Platforms column can carry the same
              // signal a click-through would show: red if that channel failed,
              // a trophy if it's a published winner (matches WinnerToggle's
              // icon/color exactly — same signal, same look, different surface).
              const platformStates = platforms.map((p) => {
                const forPlatform = pieces.filter((pp) => pp.platform === p)
                return {
                  platform: p,
                  failed: forPlatform.some((pp) => pp.status === 'failed'),
                  winner: forPlatform.some((pp) => pp.status === 'published' && pp.performed_well),
                }
              })
              const failedPlatforms = [...new Set(pieces.filter((p) => p.status === 'failed').map((p) => p.platform))]
              const hasFailed = failedPlatforms.length > 0
              const subject = storySubject(s)
              const isExpanded = expanded.has(s.id)

              return (
                <RowGroup key={s.id}>
                  {showMonth && (
                    <tr aria-hidden="true">
                      <td colSpan={7} className="bg-muted/40 text-2xs font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-1.5">
                        {ml}
                      </td>
                    </tr>
                  )}
                  <tr
                    onClick={() => navigate(`/stories/${s.id}`)}
                    onMouseEnter={() => qc.prefetchQuery({
                      queryKey: queryKeys.stories.detail(s.id),
                      queryFn: () => fetchStory(s.id),
                      staleTime: 30_000,
                    })}
                    className="border-b border-border/60 last:border-b-0 hover:bg-primary/5 cursor-pointer transition-colors"
                  >
                    <td className="px-1 align-middle w-9">
                      {/* Disclosure — expands the story into per-channel sub-rows.
                          stopPropagation so opening channels never also fires the
                          row's navigate-to-StoryDetail. Row click, hover-prefetch,
                          and the Subject link all stay intact. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(s.id) }}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Hide channels' : 'Show channels'}
                        className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                      </button>
                    </td>
                    <td className={`px-3.5 py-2.5 align-middle whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground border-l-2 ${rail}`}>
                      {fmtShortDate(ms)}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle max-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Link
                          to={`/stories/${s.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-foreground truncate hover:underline focus:outline-none focus-visible:underline"
                          title={subject || 'No topic set'}
                        >
                          {subject || <span className="italic text-muted-foreground font-normal">No topic set</span>}
                        </Link>
                        {s.campaign_id && s.campaign_name ? (
                          <span className="shrink-0 inline-flex items-center gap-1 text-3xs font-semibold rounded-full px-1.5 py-0.5 border border-action/25 bg-action/10 text-action">
                            <Target className="w-2.5 h-2.5" aria-hidden="true" />
                            <span className="max-w-[8rem] truncate">{s.campaign_name}</span>
                          </span>
                        ) : null}
                        {hasFailed && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-3xs font-bold rounded-full px-1.5 py-0.5 bg-destructive text-destructive-foreground">
                            <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                            {failedPlatforms.length === 1
                              ? `${PLATFORM_SHORT[failedPlatforms[0]] ?? failedPlatforms[0]} failed`
                              : `${failedPlatforms.length} failed`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 align-middle whitespace-nowrap">
                      <StaffChip
                        id={s.staff_id}
                        name={s.staff_name}
                        size="xs"
                        showName
                        nameClassName="text-xs text-muted-foreground truncate max-w-[7rem]"
                      />
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      <span className={`inline-flex items-center text-2xs font-semibold px-2 py-0.5 rounded-full ${badge}`}>
                        {label}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      {platforms.length > 0 ? (
                        <div className="flex items-center gap-1">
                          {platformStates.slice(0, 3).map(({ platform: p, failed, winner }) => (
                            <span
                              key={p}
                              title={failed ? 'Failed to publish' : winner ? 'Marked as a winner' : undefined}
                              className={`inline-flex items-center gap-0.5 text-3xs font-semibold rounded px-1.5 py-0.5 whitespace-nowrap border ${
                                failed
                                  ? 'text-destructive bg-destructive/10 border-destructive/40'
                                  : 'text-muted-foreground bg-muted border-border'
                              }`}
                            >
                              {winner && <Trophy className="h-2.5 w-2.5 fill-success text-success" aria-hidden="true" />}
                              {PLATFORM_SHORT[p] ?? p}
                            </span>
                          ))}
                          {platforms.length > 3 && (
                            <span className="text-3xs font-semibold text-muted-foreground px-1">+{platforms.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-2xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle text-right whitespace-nowrap tabular-nums text-muted-foreground">
                      {s.pieces_count ?? 0}
                    </td>
                  </tr>
                  {isExpanded && <ExpandedChannelRows story={s} />}
                </RowGroup>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pager — only when the result set overflows one page */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 flex-wrap px-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            Showing {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => goToPage(safePage - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
            </Button>
            <span className="text-xs font-medium text-muted-foreground px-2 tabular-nums">
              Page {safePage + 1} / {pageCount}
            </span>
            <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => goToPage(safePage + 1)}>
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// A <tbody> can't hold a fragment key cleanly across two sibling <tr>s in some
// React/JSX setups; this thin wrapper renders the optional month header + the
// story row as adjacent rows under one stable key.
function RowGroup({ children }) {
  return <>{children}</>
}

/**
 * Per-channel sub-rows for an expanded story. Mounted only while the row is
 * expanded, so useStory fetches lazily on first expand — reusing the same
 * queryKeys.stories.detail cache the row already warms on hover (no new N+1).
 *
 * The full-piece detail carries `content`, so a caption preview shows once the
 * detail query resolves; until then (or for the slim list shape) it degrades to
 * platform + status + time + Edit. Each row's Edit opens /publish/:pieceId
 * (StoryboardPublish) — the same canonical per-channel editor a story piece
 * already uses. Module scope (react-hooks/static-components).
 */
function ExpandedChannelRows({ story }) {
  const { data } = useStory(story.id)
  // Prefer the full pieces (with caption content) once loaded; fall back to the
  // slim list-shape pieces so status/platform/time render instantly on expand.
  const pieces = (data?.pieces?.length ? data.pieces : story.pieces) || []

  if (pieces.length === 0) {
    return (
      <tr className="bg-muted/25">
        <td colSpan={7} className="px-3.5 py-3 text-2xs text-muted-foreground pl-12">
          No channels yet for this story.
        </td>
      </tr>
    )
  }

  return (
    <>
      {pieces.map((p) => {
        const state = channelState(p)
        const meta = CH_STATE[state]
        const label = PLATFORM_META[p.platform]?.label || PLATFORM_SHORT[p.platform] || p.platform
        const preview = captionPreview(p.content)
        const when = channelWhen(state, p)
        return (
          <tr key={p.id} className="bg-muted/25 border-b border-dashed border-border/50 last:border-b-0">
            <td colSpan={7} className="p-0">
              <div className={`flex items-center gap-3 py-2 pr-3.5 border-l-2 pl-11 ${meta.rail}`}>
                <span className="w-24 shrink-0 text-xs font-bold text-foreground truncate" title={label}>
                  {label}
                </span>
                <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={preview || undefined}>
                  {preview || <span className="italic">No caption yet</span>}
                </span>
                <span className={`shrink-0 text-3xs font-bold px-2 py-0.5 rounded-full ${meta.pill}`}>
                  {meta.label}
                </span>
                <span className="w-28 shrink-0 text-right text-2xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {when}
                </span>
                <Link
                  to={`/publish/${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-xs font-semibold text-primary px-2.5 py-1 rounded-md border border-primary/30 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
                >
                  Edit →
                </Link>
              </div>
            </td>
          </tr>
        )
      })}
    </>
  )
}
