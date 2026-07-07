import { useSearchParams, Link } from 'react-router-dom'
import { Mic, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import StoryCard from './StoryCard'
import EmptyState from '@/components/EmptyState'

function SkeletonCard() {
  return (
    <div className="bg-card rounded-2xl shadow-sm border border-border p-4 animate-pulse">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="h-4 bg-muted rounded w-1/2" />
        <div className="h-5 bg-muted rounded-full w-16 shrink-0" />
      </div>
      <div className="h-3 bg-muted rounded mb-1.5 w-full" />
      <div className="h-3 bg-muted rounded mb-3 w-4/5" />
      <div className="flex gap-2 mb-3">
        <div className="h-4 bg-muted rounded w-10" />
        <div className="h-4 bg-muted rounded w-10" />
      </div>
      <div className="h-3 bg-muted rounded w-24" />
    </div>
  )
}

/**
 * StoriesCardsView — responsive grid of StoryCard components.
 * Filtering is applied here from URL params; the campaign strip and filter
 * controls live in the parent Stories page.
 *
 * @param {{ stories: Array, isLoading: boolean }} props
 */
export default function StoriesCardsView({ stories = [], isLoading = false }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const platformFilter = searchParams.get('platform') || ''
  const stageFilter    = searchParams.get('stage')    || ''
  const locationFilter = searchParams.get('location') || ''
  const campaignFilter = searchParams.get('campaign') || ''
  const archetypeFilter = searchParams.get('archetype') || ''
  const failedOnly = searchParams.get('status') === 'failed'

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }

  const filtered = stories.filter((s) => {
    if (platformFilter && !s.pieces?.some((p) => p.platform === platformFilter)) return false
    if (stageFilter    && s.story_stage !== stageFilter)                          return false
    if (locationFilter && s.location_id !== locationFilter)                       return false
    if (campaignFilter && s.campaign_id !== campaignFilter)                       return false
    if (archetypeFilter && s.prototype_id !== archetypeFilter)                    return false
    if (failedOnly && !s.pieces?.some((p) => p.status === 'failed'))              return false
    return true
  })

  const filtersActive = !!(platformFilter || stageFilter || campaignFilter || locationFilter || archetypeFilter || failedOnly)

  if (filtered.length === 0) {
    if (filtersActive) {
      const clearFilters = () => setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('platform')
        next.delete('stage')
        next.delete('campaign')
        next.delete('archetype')
        next.delete('location')
        next.delete('status')
        return next
      }, { replace: true })
      return (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center">
          <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center mb-3">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">No stories match your filters</p>
          <p className="text-xs mt-1 mb-3">Try widening or clearing them to see more.</p>
          <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>
        </div>
      )
    }

    return (
      <EmptyState
        icon={<Mic className="h-5 w-5" />}
        title="Your stories start with a conversation"
        description="Talk for a few minutes about your practice and Bernard turns it into a story — a cluster of publish-ready drafts your team can review and send out."
        action={
          <Button asChild size="sm">
            <Link to="/new/live-interview">Start a conversation</Link>
          </Button>
        }
        secondaryAction={
          <Button asChild size="sm" variant="outline">
            <Link to="/new/import">Import existing content</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {filtered.map((story) => (
        <StoryCard key={story.id} story={story} />
      ))}
    </div>
  )
}
