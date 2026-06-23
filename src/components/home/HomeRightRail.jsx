import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, Sparkles, RefreshCw, TrendingUp } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTopicSuggestions, useTopPerformers, queryKeys } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'

const PLATFORM_LABELS = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'Twitter / X',
  gbp: 'Google Business',
  wordpress: 'Website',
  email: 'Email',
}

function formatScheduled(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Skeleton loader — 5 shimmer rows while suggestions are fetching.
function SuggestionSkeleton() {
  return (
    <ul className="divide-y">
      {[...Array(5)].map((_, i) => (
        <li key={i} className="px-4 py-2.5">
          <div className="h-3.5 bg-muted rounded animate-pulse w-4/5" />
        </li>
      ))}
    </ul>
  )
}

// Right rail for the Home page.
// Props:
//   stories  — array from useStories() — we filter to upcoming scheduled pieces
export default function HomeRightRail({ stories = [] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const { data, isLoading, isFetching } = useTopicSuggestions()
  const { data: topPerformers = [] } = useTopPerformers()

  const now = Date.now()
  const in7Days = now + 7 * 24 * 60 * 60 * 1000

  // Flatten stories → pieces, keep only pieces with scheduled_at in next 7 days
  const upcoming = stories
    .flatMap((s) =>
      (s.pieces || [])
        .filter((p) => {
          if (!p.scheduled_at) return false
          const t = new Date(p.scheduled_at).getTime()
          return t >= now && t <= in7Days
        })
        .map((p) => ({ ...p, storyId: s.id, staffName: s.staffName }))
    )
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 8)

  const suggestions = data?.suggestions ?? []

  function handleSuggestionClick(topic) {
    navigate(`/new?topic=${encodeURIComponent(topic)}`)
  }

  async function handleRefresh() {
    // Hit ?refresh=true to bust the 7-day server-side cache and regenerate.
    // Use apiFetch so the Clerk Bearer token is attached — requireRole() in
    // api/topic-suggestions.js reads only the Authorization header (no cookie
    // fallback), so a raw credentials:'include' fetch 401s and the cache is
    // never busted. apiFetch also throws on non-2xx, so HTTP failures surface
    // as a toast instead of being silently swallowed.
    //
    // The refresh response IS the freshly-generated payload — seed the query
    // cache with it directly rather than firing a follow-up refetch. A refetch
    // of the plain endpoint can land on a sibling instance whose 60s
    // workspaceContext cache still holds the old ai_topics_cache, re-serving
    // the stale topics the user just tried to replace.
    setRefreshing(true)
    try {
      const fresh = await apiFetch('/api/topic-suggestions?refresh=true')
      qc.setQueryData(queryKeys.topicSuggestions, fresh)
    } catch (err) {
      toast.error('Failed to refresh suggestions', { description: err.message })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Upcoming scheduled posts */}
      <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="inline-block w-1 h-5 rounded-full shrink-0" style={{ background: 'hsl(var(--scheduled))' }} aria-hidden="true" />
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-bold tracking-tight flex-1">Scheduled this week</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            Nothing scheduled in the next 7 days.
          </p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/stories/${p.storyId}`}
                  className="flex flex-col gap-0.5 px-4 py-2.5 hover:bg-accent/20 transition-colors"
                >
                  <span className="text-xs font-medium text-foreground truncate">
                    {PLATFORM_LABELS[p.platform] || p.platform}
                    {p.staffName ? ` · ${p.staffName}` : ''}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {formatScheduled(p.scheduled_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* What's working — top performers by reach */}
      {topPerformers.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <span className="inline-block w-1 h-5 rounded-full shrink-0" style={{ background: 'hsl(var(--success))' }} aria-hidden="true" />
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-bold tracking-tight flex-1">What&apos;s working</h2>
          </div>
          <ul className="divide-y">
            {topPerformers.map((item) => (
              <li key={item.id} className="px-4 py-2.5 flex flex-col gap-0.5">
                <span className="text-xs font-medium text-foreground truncate leading-snug">
                  {item.topic || 'Untitled'}
                </span>
                <div className="flex items-center gap-2 text-2xs text-muted-foreground">
                  <span>{PLATFORM_LABELS[item.platform] || item.platform}</span>
                  {item.source === 'ga4' ? (
                    item.pageviews > 0 && (
                      <span className="font-medium text-success">
                        {item.pageviews.toLocaleString()} views
                      </span>
                    )
                  ) : (
                    <>
                      {item.reach > 0 && (
                        <span className="font-medium text-success">
                          {item.reach.toLocaleString()} reach
                        </span>
                      )}
                      {item.engagement > 0 && (
                        <span>{item.engagement} engagements</span>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Topic suggestions — AI-generated patient questions */}
      <div className="rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <span className="inline-block w-1 h-5 rounded-full shrink-0" style={{ background: 'hsl(var(--info))' }} aria-hidden="true" />
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-bold tracking-tight flex-1">Questions patients are asking</h2>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || isFetching || refreshing}
            title="Refresh suggestions"
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching || refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {isLoading ? (
          <SuggestionSkeleton />
        ) : suggestions.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            No suggestions yet — click refresh to generate.
          </p>
        ) : (
          <ul className="divide-y">
            {suggestions.map((topic, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => handleSuggestionClick(topic)}
                  className="w-full text-left px-4 py-2.5 text-xs text-foreground hover:bg-accent/20 transition-colors leading-snug"
                >
                  {topic}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
