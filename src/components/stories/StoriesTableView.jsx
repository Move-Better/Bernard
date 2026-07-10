import { useMemo, useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Mic, SearchX, AlertTriangle, Target, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StaffChip } from '@/components/StaffChip'
import EmptyState from '@/components/EmptyState'
import { getStageToken } from '@/lib/stageTokens'
import { queryKeys, fetchStory } from '@/lib/queries'

// Rows per page — bounds the rendered DOM so the list scales to thousands of
// stories without ever mounting thousands of rows (Q: "won't scale").
const PAGE_SIZE = 50

// Short platform labels for the compact platform column.
const PLATFORM_SHORT = {
  blog: 'Blog', instagram: 'IG', instagram_story: 'Story', facebook: 'FB',
  linkedin: 'LI', gbp: 'GBP', google_ads: 'G Ads', instagram_ads: 'IG Ads',
  landing_page: 'LP', youtube: 'YT', tiktok: 'TT', email: 'Email',
}

// The story date the list sorts + groups by. created_at is the interview date
// (also the source of the date-first display title); fall back to last activity.
function storyDateMs(s) {
  const iso = s.created_at || s.last_activity_at || s.updated_at
  return iso ? new Date(iso).getTime() : 0
}

function fmtShortDate(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${mm}/${dd}/${yy}`
}

function monthLabel(ms) {
  if (!ms) return 'Undated'
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Titles are becoming date-first ("MM/DD/YY — subject"); the table has its own
// Date column, so strip a leading date prefix from the topic to keep the Subject
// column clean and non-redundant. (Title LOGIC proper lives in a shared helper
// owned by a sibling task; this is a defensive display-only strip for the list.)
const DATE_PREFIX_RE = /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*[—–-]\s*/
function storySubject(s) {
  const t = (s.topic || '').trim()
  if (!t) return ''
  return t.replace(DATE_PREFIX_RE, '').trim() || t
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
              const { badge, label } = getStageToken(s.story_stage || '')
              const platforms = [...new Set((s.pieces || []).map((p) => p.platform).filter(Boolean))]
              const hasFailed = (s.pieces || []).some((p) => p.status === 'failed')
              const subject = storySubject(s)

              return (
                <RowGroup key={s.id}>
                  {showMonth && (
                    <tr aria-hidden="true">
                      <td colSpan={6} className="bg-muted/40 text-2xs font-bold uppercase tracking-wider text-muted-foreground px-3.5 py-1.5">
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
                    <td className="px-3.5 py-2.5 align-middle whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
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
                            Failed
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
                          {platforms.slice(0, 3).map((p) => (
                            <span key={p} className="text-3xs font-semibold text-muted-foreground bg-muted border border-border rounded px-1.5 py-0.5 whitespace-nowrap">
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
