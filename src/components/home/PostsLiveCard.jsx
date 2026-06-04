import { Link } from 'react-router-dom'
import { PartyPopper, Image, Play, ChevronRight, Sparkles } from 'lucide-react'
import { PLATFORM_META } from '@/lib/contentMeta'

// PostsLiveCard — the "close the loop" payoff surface on Home. Shows the
// current clinician's pieces that went live in the last 7 days, framed as a
// celebration ("🎉 Your posts are live"). This is the persistent companion to
// the fleeting publish toast: the toast fires once at publish time, this card
// holds the record so the reward is still here when they come back.
//
// Personal by design — filtered to the logged-in user's own stories
// (owner_id), so each clinician sees *their* wins, not the whole workspace's.
//
// Auto-hides when the user has nothing live this week, so quiet/new accounts
// never see an empty trophy case.

const LIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Friendly platform labels, de-duped and capped so the sub-line stays short.
function platformLabels(platforms) {
  const seen = []
  for (const p of platforms) {
    const label = PLATFORM_META[p]?.label?.replace(' Post', '') ?? p
    if (label && !seen.includes(label)) seen.push(label)
  }
  return seen
}

function liveAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60 * 60 * 1000) return 'Live just now'
  const hours = Math.round(ms / (60 * 60 * 1000))
  if (hours < 24) return `Live ${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'Live yesterday' : `Live ${days}d ago`
}

export default function PostsLiveCard({ stories = [], userId }) {
  // Flatten to recently-published pieces owned by the current user, grouped
  // back to one entry per story (a story that fans out to IG + FB is one win,
  // not two). Newest publish first.
  const now = Date.now()
  const byStory = new Map()
  for (const s of stories) {
    if (userId && s.owner_id !== userId) continue
    for (const p of s.pieces || []) {
      if (p.status !== 'published' || !p.published_at) continue
      if (now - new Date(p.published_at).getTime() > LIVE_WINDOW_MS) continue
      const entry = byStory.get(s.id) || {
        storyId: s.id,
        topic: s.topic,
        publishedAt: p.published_at,
        platforms: [],
        hasVideo: false,
        interviewDate: s.created_at,
      }
      entry.platforms.push(p.platform)
      if (new Date(p.published_at) > new Date(entry.publishedAt)) entry.publishedAt = p.published_at
      if (p.platform === 'youtube' || p.platform === 'tiktok') entry.hasVideo = true
      byStory.set(s.id, entry)
    }
  }

  const live = [...byStory.values()].sort(
    (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
  )
  if (live.length === 0) return null

  return (
    <div className="rounded-2xl overflow-hidden border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(16,185,129,0.25)]">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-emerald-100">
        <PartyPopper className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <h2 className="text-base font-bold tracking-tight text-emerald-800 flex-1">Your posts are live</h2>
        <span className="nx-pill nx-pill-emerald">
          {live.length} {live.length === 1 ? 'this week' : 'this week'}
        </span>
      </div>

      <div className="divide-y divide-emerald-50">
        {live.map((item) => {
          const labels = platformLabels(item.platforms)
          const Icon = item.hasVideo ? Play : Image
          return (
            <Link
              key={item.storyId}
              to={`/stories/${item.storyId}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-emerald-50/40 transition-colors group"
            >
              <div className="h-11 w-11 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{item.topic}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {liveAgo(item.publishedAt)}
                  {labels.length ? ` · ${labels.join(', ')}` : ''}
                </p>
              </div>
              <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-0.5 shrink-0 group-hover:underline underline-offset-2">
                View post <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          )
        })}
      </div>

      <div className="px-4 py-2.5 bg-emerald-50/60 text-2xs text-emerald-700 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Reach &amp; “how’d you hear about us?” will land here next — closing the outcome loop.
      </div>
    </div>
  )
}
