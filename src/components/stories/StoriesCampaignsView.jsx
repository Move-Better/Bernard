import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flag, Loader2 } from 'lucide-react'
import EmptyState from '@/components/EmptyState'

/**
 * StoriesCampaignsView — the clinic board's "Campaigns" lens (portfolio mockup).
 *
 * Groups stories by campaign and shows a published / scheduled / in-progress
 * progress bar per campaign, plus a quick chip list of the contributing
 * stories. Stories with no campaign roll up under "Standard". Read-only —
 * clicking a chip opens the story.
 */
export default function StoriesCampaignsView({ stories = [], isLoading = false }) {
  const navigate = useNavigate()

  const campaigns = useMemo(() => {
    const map = new Map()
    for (const story of stories) {
      const key = story.campaign_name || 'Standard'
      if (!map.has(key)) {
        map.set(key, { name: key, isCampaign: !!story.campaign_name, stories: [], published: 0, scheduled: 0, rest: 0 })
      }
      const group = map.get(key)
      group.stories.push(story)
      const s = story.pieces_by_status || {}
      group.published += s.published ?? 0
      group.scheduled += s.scheduled ?? 0
      group.rest += (s.draft ?? 0) + (s.in_review ?? 0) + (s.approved ?? 0)
    }
    // Real campaigns first, then by piece volume.
    return [...map.values()].sort((a, b) => {
      if (a.isCampaign !== b.isCampaign) return a.isCampaign ? -1 : 1
      return (b.published + b.scheduled + b.rest) - (a.published + a.scheduled + a.rest)
    })
  }, [stories])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={<Flag className="h-5 w-5" />}
        title="No campaigns yet"
        description="Content grouped by campaign will appear here once a campaign is running."
        size="sm"
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {campaigns.map((c) => {
        const total = c.published + c.scheduled + c.rest || 1
        return (
          <div
            key={c.name}
            className={`rounded-xl border bg-card p-4 ${c.isCampaign ? 'border-primary/40' : ''}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <Flag className={`h-4 w-4 ${c.isCampaign ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-sm font-semibold">{c.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{c.stories.length} stories</span>
            </div>
            <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-muted">
              <div className="bg-success" style={{ width: `${(c.published / total) * 100}%` }} />
              <div className="bg-info" style={{ width: `${(c.scheduled / total) * 100}%` }} />
              <div className="bg-primary/60" style={{ width: `${(c.rest / total) * 100}%` }} />
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" />{c.published} published</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" />{c.scheduled} scheduled</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary/60" />{c.rest} in progress</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {c.stories.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigate(`/stories/${s.id}`)}
                  className="rounded-full border px-2 py-1 text-2xs transition-colors hover:border-primary hover:text-primary"
                >
                  {(s.topic || 'Untitled').slice(0, 28)}
                </button>
              ))}
              {c.stories.length > 8 && (
                <span className="px-2 py-1 text-2xs text-muted-foreground">+{c.stories.length - 8} more</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
